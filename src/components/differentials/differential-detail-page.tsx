"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import {
  TriangleAlert,
  Bookmark,
  BookmarkCheck,
  BrainCircuit,
  CircleCheck,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleHelp,
  FlaskConical,
  GitCompareArrows,
  Plus,
  Share2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import type { DifferentialRecordGovernance } from "@/components/clinical-dashboard/use-differential-catalog";
import {
  buildDifferentialSectionIndex,
  type DifferentialDetailSection,
} from "@/components/differentials/detail-section-index";
import { DiagnosisMapPanel } from "@/components/differentials/diagnosis-map-panel";
import type { DifferentialCuratedEntry } from "@/lib/differential-curated";
import { DifferentialOverviewRail } from "@/components/differentials/differential-overview-rail";
import { DiagnosisTermChip, DiagnosisTermInline } from "@/components/differentials/diagnosis-term-link";
import { CopyAfterReviewButton } from "@/components/differentials/differential-presentation-actions";
import { idsCompareHref } from "@/components/compare";
import { COMPARE_MAX_COUNT } from "@/components/differentials/differential-compare-picker-control";
import { inPageActionRowClass as actionRowClass } from "@/components/in-page-nav/in-page-nav-classes";
import { InPageNavHeader } from "@/components/in-page-nav/in-page-nav-header";
import {
  RecordBody,
  RecordCautions,
  RecordGlance,
  RecordIntro,
  RecordSection,
} from "@/components/clinical-record-panels";
import { buttonFaceClass } from "@/components/ui/button-face";
import { StatusMark } from "@/components/ui/status-mark";
import { cn, pageContainer, toneDanger, toneNeutral, toneWarning } from "@/components/ui-primitives";
import { appModeHomeHref } from "@/lib/app-modes";
import {
  cleanDifferentialItem,
  curatedContentNote,
  curatedProvenanceFor,
  doNowHeading,
  doNowStepsAreCurated,
  detailTabCounts,
  differentialGroupLabel,
  differentialGroupScopeNote,
  differentialSourceStatusLabel,
  differentialStatusLabel,
  differentialValidationStatusLabel,
  formatDifferentialCopyText,
  formatExportedDate,
  generatedBodyWithheld,
  groupCurrentPresentation,
  hasCuratedContent,
  isDetailTabId,
  isRedundantSafetySummary,
  resolveDoNowSteps,
  resolveSafetyFacts,
  sectionBadgeLabel,
  sectionScopeLabel,
  visibleSectionItems,
  withholdGeneratedBody,
  type DifferentialDetailContext,
  type DifferentialDetailTabId,
} from "@/lib/differential-detail";
import type { DifferentialRecord, DifferentialSection } from "@/lib/differentials";
import { useAccountData } from "@/components/account-data-provider";

const statusToneClass: Record<DifferentialRecord["status"], string> = {
  emergent: toneDanger,
  urgent: toneWarning,
  routine: toneNeutral,
};

const rowMeta: Record<DifferentialSection["tone"], { label: string; badgeClassName: string }> = {
  fit: {
    label: "Key features",
    badgeClassName: "bg-[color:var(--success-soft)] text-[color:var(--success)]",
  },
  warning: {
    label: "High-risk causes",
    badgeClassName: "bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
  },
  question: {
    label: "Helpful clues",
    badgeClassName: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
  },
  action: {
    label: "Priority steps",
    badgeClassName: "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  },
  test: {
    label: "Core tests",
    badgeClassName: "bg-[color:var(--info-soft)] text-[color:var(--info)]",
  },
  overlap: {
    label: "Consider",
    badgeClassName: "bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  },
};

/** Maps a related node's likelihood to its own severity tag, mirroring the record-status tones. */
function likelihoodTag(likelihood: DifferentialRecord["related"][number]["likelihood"]) {
  if (likelihood === "must-not-miss") return { label: "Emergent", className: statusToneClass.emergent };
  if (likelihood === "possible") return { label: "Urgent", className: statusToneClass.urgent };
  return { label: "Review", className: statusToneClass.routine };
}

const sectionItemIcons: Partial<Record<DifferentialSection["tone"], LucideIcon>> = {
  fit: CircleCheck,
  warning: TriangleAlert,
  question: CircleHelp,
  test: FlaskConical,
};

const sectionItemIconClass: Partial<Record<DifferentialSection["tone"], string>> = {
  fit: "text-[color:var(--success)]",
  warning: "text-[color:var(--danger)]",
  question: "text-[color:var(--info)]",
  test: "text-[color:var(--info)]",
};

/**
 * Renders section items according to the section tone.
 *
 * @param section - The section whose tone determines the item layout and styling
 * @param items - The items to display
 * @param termLinks - Maps cleaned item labels to diagnosis slugs for linked items
 * @returns The rendered section item list
 */
function SectionItems({
  section,
  items,
  termLinks,
}: {
  section: DifferentialSection;
  items: string[];
  termLinks: Record<string, string>;
}) {
  if (section.tone === "action") {
    return (
      <ol className="grid gap-2">
        {items.map((item, index) => {
          const slug = termLinks[item] ?? null;
          return (
            <li key={item} className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-2xs font-extrabold text-[color:var(--clinical-accent)]">
                {index + 1}
              </span>
              <span className="pt-0.5 text-sm leading-6 text-[color:var(--text)]">
                {slug ? <DiagnosisTermInline label={item} slug={slug} /> : item}
              </span>
            </li>
          );
        })}
      </ol>
    );
  }

  if (section.tone === "overlap") {
    return (
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item}>
            <DiagnosisTermChip label={item} slug={termLinks[item] ?? null} tone="accent" />
          </li>
        ))}
      </ul>
    );
  }

  const Icon = sectionItemIcons[section.tone] ?? CircleCheck;
  return (
    <ul
      className={cn(
        "grid gap-2",
        section.tone === "warning" &&
          "rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] p-3",
      )}
    >
      {items.map((item) => {
        const slug = termLinks[item] ?? null;
        return (
          <li key={item} className="flex items-start gap-2">
            <Icon
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0",
                sectionItemIconClass[section.tone] ?? "text-[color:var(--text-muted)]",
              )}
              aria-hidden
            />
            <span className="text-sm leading-6 text-[color:var(--text)]">
              {slug ? <DiagnosisTermInline label={item} slug={slug} /> : item}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Says when a section's text describes the presentation group rather than this
 * diagnosis. The imported corpus derives hinge, action, investigation and mimic
 * text from the group, so acute dystonia's "Bedside question" is the akathisia
 * discriminator. Labelling it is what keeps the page from asserting it of this
 * diagnosis. See tests/differentials-presentation-scope.test.ts.
 */
/** Short per-row marker for a section written about the presentation group. The
 *  full sentence ("Applies to the … group — not specific to …") is shown once at
 *  the top of the Clinical review list instead of on every row. */
function ScopeNote({ label }: { label: string }) {
  return (
    <p className="mt-1 text-2xs font-semibold text-[color:var(--text-muted)]" title={label}>
      <span className="sr-only">{label}. </span>
      <span aria-hidden>Whole group</span>
    </p>
  );
}

function SectionRow({
  section,
  record,
  open,
  onOpenChange,
  termLinks,
}: {
  section: DifferentialSection;
  record: DifferentialRecord;
  open: boolean;
  onOpenChange: (id: string, open: boolean) => void;
  termLinks: Record<string, string>;
}) {
  const meta = rowMeta[section.tone];
  const items = useMemo(() => visibleSectionItems(section, record), [section, record]);
  const badge = sectionBadgeLabel(section, record);
  const scopeNote = sectionScopeLabel(section, record);

  if (items.length === 0) {
    return (
      <article
        id={`differential-section-${section.id}`}
        data-testid="differential-section-row"
        className="grid min-h-[4.25rem] scroll-mt-24 grid-cols-[minmax(0,1fr)] items-center gap-3 border-b border-[color:var(--border)] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_9rem]"
      >
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[color:var(--text-heading)]">{section.title}</h3>
          {scopeNote ? <ScopeNote label={scopeNote} /> : null}
          <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)] sm:text-sm sm:leading-6">
            {section.summary}
          </p>
        </div>
        <span className="hidden justify-self-end text-xs font-semibold text-[color:var(--text-muted)] sm:block">
          {meta.label}
        </span>
      </article>
    );
  }

  return (
    <details
      id={`differential-section-${section.id}`}
      data-testid="differential-section-row"
      className="group scroll-mt-24 border-b border-[color:var(--border)] last:border-b-0"
      open={open}
      onToggle={(event) => {
        // Native toggle also fires for prop-driven and browser-initiated flips
        // (expand-all, find-in-page auto-expand); sync from the DOM state
        // instead of inverting so echoes converge instead of looping.
        const next = event.currentTarget.open;
        if (next !== open) onOpenChange(section.id, next);
      }}
    >
      <summary className="grid min-h-[4.25rem] cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_9rem_5.5rem_2rem] [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-[color:var(--text-heading)]">{section.title}</h3>
          {scopeNote ? <ScopeNote label={scopeNote} /> : null}
          <p
            className={cn(
              "mt-1 line-clamp-2 text-xs leading-5 text-[color:var(--text-muted)] sm:text-sm sm:leading-6",
              // The generated immediate-action summary is a garbled run-on
              // (concatenated sentences); its content reads properly in the
              // expanded numbered list instead, so keep it clamped.
              section.tone !== "action" && "group-open:line-clamp-none",
            )}
          >
            {section.summary}
          </p>
        </div>
        <span className="hidden justify-self-end text-xs font-semibold text-[color:var(--text-muted)] sm:block">
          {meta.label}
        </span>
        <span
          className={cn(
            "justify-self-end rounded-md px-2 py-1 text-xs font-bold shadow-[var(--shadow-inset)]",
            meta.badgeClassName,
          )}
        >
          {badge}
        </span>
        <ChevronDown
          className="h-4 w-4 justify-self-end text-[color:var(--decoration-soft)] transition group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div data-testid="differential-section-items" className="pb-4 pt-1">
        <SectionItems section={section} items={items} termLinks={termLinks} />
      </div>
    </details>
  );
}

/**
 * The record's summary facts (High-risk, Actions, Related and the rest of
 * `resolveSafetyFacts`) in the shared "At a glance" card, labels in full.
 */
function SafetyGlance({ record, curated }: { record: DifferentialRecord; curated: DifferentialCuratedEntry | null }) {
  const facts = resolveSafetyFacts(record, curated);
  if (facts.length === 0) return null;
  return (
    <RecordGlance
      testId="differential-at-a-glance"
      valueTestId="differential-safety-value"
      facts={facts.map((fact) => ({ key: fact.id, label: fact.label, value: fact.value, wide: false }))}
    />
  );
}

/**
 * Cautions, directly after At a glance and in full: the safety summary and
 * every "Watch for" item. The items wrap rather than scroll sideways, so none
 * is cut off at the edge of a phone.
 */
function SafetySnapshot({ record, termLinks }: { record: DifferentialRecord; termLinks: Record<string, string> }) {
  const tags = record.safetySnapshot.tags;
  const summary = record.safetySnapshot.summary.trim();
  const showSummary = summary.length > 0 && !isRedundantSafetySummary(summary, tags);
  if (!showSummary && tags.length === 0) return null;

  return (
    <RecordCautions title="Safety snapshot" testId="differential-safety-snapshot">
      {showSummary ? <p className="m-0 font-semibold text-[color:var(--text-heading)]">{summary}</p> : null}

      {tags.length > 0 ? (
        <div
          className={cn("flex min-w-0 flex-wrap items-center gap-1.5", showSummary && "mt-2")}
          data-testid="differential-safety-watchlist"
        >
          <span className="shrink-0 text-xs font-bold text-[color:var(--text-heading)]">Watch for</span>
          {tags.map((tag) => {
            const cleaned = cleanDifferentialItem(tag);
            return (
              <DiagnosisTermChip
                key={tag}
                label={cleaned}
                slug={termLinks[cleaned] ?? null}
                tone="danger"
                // compact-meta (40px), not min-h-tap: a "Watch for" row mixes
                // linked and unlinked tags of identical size, so a tap-sized
                // chip only when linked would jump size mid-row. TOKENS.md §2's
                // compact-meta role list ("filter chips") is the closest
                // documented fit (TOKENS.md requires this comment).
                className={cn(
                  !termLinks[cleaned] &&
                    "border-[color:var(--warning-border)] bg-[color:var(--surface)] text-[color:var(--warning-text)]",
                  "min-h-compact-meta px-2 text-xs",
                )}
              />
            );
          })}
        </div>
      ) : null}
    </RecordCautions>
  );
}

/**
 * The discriminating line the catalogue carries, sitting directly under the
 * safety snapshot where the eye lands next.
 *
 * It is populated on all 201 records, but on every one of them it is the
 * PRESENTATION GROUP's hinge, not the diagnosis's: 201 records share 31 distinct
 * hinges. Headed plainly "Clinical hinge" it read as this diagnosis's own
 * discriminator, so the acute dystonia page led with the akathisia one. The
 * heading and the note below now say whose question it is. See
 * `withPresentationScope()` in `src/lib/differentials.ts` and
 * `tests/differentials-presentation-scope.test.ts`.
 */
function ClinicalHinge({ record }: { record: DifferentialRecord }) {
  const hinge = cleanDifferentialItem(record.clinicalHinge);
  if (!hinge) return null;
  const groupScoped = record.clinicalHingeScope === "presentation";
  const group = differentialGroupLabel(record);

  return (
    <RecordSection testId="differential-clinical-hinge" title={groupScoped ? "Presentation hinge" : "Clinical hinge"}>
      <p className="m-0 text-base font-semibold leading-7 text-[color:var(--text-heading)]">{hinge}</p>
      {groupScoped ? (
        <p
          data-testid="differential-clinical-hinge-scope"
          className="mt-1.5 text-xs leading-5 text-[color:var(--text-muted)]"
        >
          {group
            ? `Separates the ${group} group. It is not specific to ${record.title}.`
            : `Separates the presentation group. It is not specific to ${record.title}.`}
        </p>
      ) : null}
    </RecordSection>
  );
}

/**
 * Shown only for records whose generated sections are known to carry material
 * from another diagnosis. Saying so above the review is the honest handling:
 * the alternative is a page that reads as authoritative while the body of it is
 * describing something else.
 */
function ContentNote({ curated }: { curated: DifferentialCuratedEntry | null }) {
  const note = curatedContentNote(curated);
  if (!note) return null;

  return (
    <section
      data-testid="differential-content-note"
      role="note"
      className="flex items-start gap-2 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-3 py-2.5 sm:px-4"
    >
      <TriangleAlert className="mt-0.5 size-icon-md shrink-0 text-[color:var(--warning)]" aria-hidden />
      <span className="min-w-0">
        <span className="block text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--warning)]">
          Check this record
        </span>
        <span className="mt-1 block text-sm leading-6 text-[color:var(--text-heading)]">{note}</span>
      </span>
    </section>
  );
}

/**
 * The authored "Do now" steps on a phone.
 *
 * `DifferentialOverviewRail` holds these on desktop and is `lg:block`, so until
 * 2026-09-16 the reviewed steps had no phone surface at all: on call, the reader
 * got the generated "Priority steps" accordion the overlay exists to replace.
 * This is the same content at the same place in the reading order, in flow, and
 * `lg:hidden` so exactly one of the two ever paints.
 */
function PhoneDoNow({ record, curated }: { record: DifferentialRecord; curated: DifferentialCuratedEntry | null }) {
  const steps = resolveDoNowSteps(record, curated);
  if (steps.length === 0) return null;
  const authored = doNowStepsAreCurated(curated);

  return (
    <RecordSection
      testId="differential-do-now-phone"
      headingId="differential-do-now-title"
      title={doNowHeading(authored)}
      className="lg:hidden"
    >
      {authored ? null : (
        <p className="mt-1 text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
          {differentialGroupScopeNote(record)}
        </p>
      )}
      {authored ? (
        <ol className="mt-2 grid gap-2">
          {steps.map((step, index) => (
            <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
              <span className="nums mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-3xs font-extrabold text-[color:var(--clinical-accent)]">
                {index + 1}
              </span>
              <span className="text-sm leading-6 text-[color:var(--text)]">{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mt-2 grid gap-2">
          {steps.map((step) => (
            <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
              <span
                className="mt-2 grid h-2 w-2 place-self-center rounded-full bg-[color:var(--clinical-accent)]"
                aria-hidden
              />
              <span className="text-sm leading-6 text-[color:var(--text)]">{step}</span>
            </li>
          ))}
        </ul>
      )}
      {authored ? (
        <p className="mt-2 text-2xs font-semibold text-[color:var(--text-muted)]">{curatedProvenanceFor(curated)}</p>
      ) : null}
    </RecordSection>
  );
}

/**
 * What stands in place of the clinical review when the generated body has been
 * withheld. An empty panel would read as a record with nothing in it, which is
 * a different and misleading claim, so the absence is stated and the reader is
 * pointed at the record's provenance.
 *
 * Deliberately does NOT offer to open an original: the Source tab carries
 * status, review state and a version line reading "Local content only", and
 * nothing here links a source document. Promising one was the same overclaim
 * this component exists to prevent, made by the component itself.
 */
function WithheldBody({ onOpenSource }: { onOpenSource: () => void }) {
  return (
    <div data-testid="differential-body-withheld" className="px-3 py-4 sm:px-4">
      <p className="text-sm font-bold text-[color:var(--text-heading)]">
        The generated review for this record is not shown
      </p>
      <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
        Its sections were found to describe a different diagnosis, so they are withheld rather than printed under a
        warning. The assessment steps above are locally authored. The safety snapshot and investigations are retained
        from the source export and were not part of the contaminated text. There is no linked original to open here, so
        treat this as unreviewed reference and check its source and review status before acting on it.
      </p>
      <button
        type="button"
        onClick={onOpenSource}
        className="mt-2 inline-flex min-h-tap items-center gap-1.5 text-xs font-semibold text-[color:var(--clinical-accent)] hover:text-[color:var(--primary-strong)]"
      >
        See source and review status
        <ChevronRight className="size-icon-sm shrink-0" aria-hidden />
      </button>
    </div>
  );
}

function RelatedDiagnoses({ record, knownRelatedSlugs }: { record: DifferentialRecord; knownRelatedSlugs: string[] }) {
  const known = new Set(knownRelatedSlugs);
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Related diagnoses
      </h2>
      <ul className="mt-2 grid gap-1">
        {record.related.map((node) => {
          const tag = likelihoodTag(node.likelihood);
          const body = (
            <>
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-[color:var(--text-heading)]">{node.label}</span>
                {node.note ? (
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-[color:var(--text-muted)]">
                    {node.note}
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn("rounded-md border px-1.5 py-0.5 text-2xs font-extrabold uppercase", tag.className)}
                >
                  {tag.label}
                </span>
                {known.has(node.id) ? (
                  <ChevronRight className="h-4 w-4 text-[color:var(--decoration-soft)]" aria-hidden />
                ) : null}
              </span>
            </>
          );
          return (
            <li key={node.id}>
              {known.has(node.id) ? (
                <Link
                  href={`/differentials/diagnoses/${node.id}`}
                  data-testid="differential-related-row"
                  className="-mx-2 flex min-h-12 items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-[color:var(--surface-subtle)]"
                >
                  {body}
                </Link>
              ) : (
                <div
                  data-testid="differential-related-row"
                  className="-mx-2 flex min-h-12 items-start justify-between gap-3 rounded-lg px-2 py-2"
                >
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CurrentPresentation({ record }: { record: DifferentialRecord }) {
  const view = groupCurrentPresentation(record.currentPresentation);
  const hingeCallout = (text: string) => (
    <p className="mt-2 flex items-start gap-2 rounded-md border border-[color:var(--info-border)] bg-[color:var(--info-soft)] p-2 text-xs leading-5 text-[color:var(--text)]">
      <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--info)]" aria-hidden />
      <span>
        <span className="font-bold">Clinical hinge:</span> {text}
      </span>
    </p>
  );

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Current presentation
      </h2>
      {view.kind === "grouped" ? (
        <div className="mt-3 grid gap-3">
          {view.groups.map((group, index) => (
            <div
              key={`${group.title}-${index}`}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3"
            >
              <p className="text-sm font-bold text-[color:var(--text-heading)]">{group.title}</p>
              <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">{group.candidates}</p>
              {hingeCallout(group.hinge)}
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-3 grid gap-2 text-xs font-semibold text-[color:var(--text-muted)]">
          {view.items.map((item, index) =>
            item.isHinge ? (
              <li key={`${item.text}-${index}`}>{hingeCallout(item.text)}</li>
            ) : (
              <li key={`${item.text}-${index}`} className="flex gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
                {item.text}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function ComparePanel({
  record,
  detailContext,
}: {
  record: DifferentialRecord;
  detailContext: DifferentialDetailContext;
}) {
  const known = new Set(detailContext.knownRelatedSlugs);
  const compareHref = detailContext.comparePresentation
    ? `/differentials/presentations/${detailContext.comparePresentation.slug}`
    : "/differentials/compare";
  const rowClassName =
    "flex min-h-12 items-center justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-xs font-semibold text-[color:var(--text-heading)]";

  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Compare with related diagnoses
      </h2>
      <p className="mt-2 text-xs leading-5 text-[color:var(--text-muted)]">
        Open a related diagnosis below, or launch the side-by-side comparison workspace for this presentation.
      </p>
      <ul className="mt-3 grid gap-2">
        <li
          className={cn(
            rowClassName,
            "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]",
          )}
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <BrainCircuit className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
            <span className="truncate">{record.title}</span>
            <span className="shrink-0 text-2xs font-extrabold uppercase text-[color:var(--text-muted)]">
              This diagnosis
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded-md border px-1.5 py-0.5 text-2xs font-extrabold uppercase",
              statusToneClass[record.status],
            )}
          >
            {differentialStatusLabel(record.status)}
          </span>
        </li>
        {record.related.map((node) => {
          const tag = likelihoodTag(node.likelihood);
          const body = (
            <>
              <span className="inline-flex min-w-0 items-center gap-2">
                <BrainCircuit className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" aria-hidden />
                <span className="truncate">{node.label}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn("rounded-md border px-1.5 py-0.5 text-2xs font-extrabold uppercase", tag.className)}
                >
                  {tag.label}
                </span>
                {known.has(node.id) ? (
                  <ChevronRight className="h-4 w-4 text-[color:var(--decoration-soft)]" aria-hidden />
                ) : null}
              </span>
            </>
          );
          return (
            <li key={node.id}>
              {known.has(node.id) ? (
                <Link
                  href={`/differentials/diagnoses/${node.id}`}
                  className={cn(rowClassName, "hover:bg-[color:var(--surface-subtle)]")}
                >
                  {body}
                </Link>
              ) : (
                <div className={rowClassName}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      <Link
        data-testid="differential-compare-open"
        href={compareHref}
        className="mt-3 inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-lg bg-[color:var(--clinical-accent)] px-4 text-sm font-semibold text-[color:var(--clinical-accent-contrast)] shadow-[var(--e2)] hover:bg-[color:var(--primary-strong)]"
      >
        <GitCompareArrows className="h-4 w-4" aria-hidden />
        Open comparison workspace
      </Link>
      {detailContext.comparePresentation ? (
        <p className="mt-2 text-xs leading-5 text-[color:var(--text-muted)]">
          Opens “{detailContext.comparePresentation.title}” with this diagnosis in the candidate list.
        </p>
      ) : null}
    </section>
  );
}

function FooterStatus({
  source,
  liveGovernance,
  curated,
}: {
  source: DifferentialDetailContext["source"];
  liveGovernance: DifferentialRecordGovernance | null;
  curated: DifferentialCuratedEntry | null;
}) {
  const sourceStatus = liveGovernance?.sourceStatus ?? source.sourceStatus;
  const validationStatus = liveGovernance?.validationStatus ?? source.validationStatus;
  const sourceToneClass =
    sourceStatus === "current"
      ? "text-[color:var(--success)]"
      : sourceStatus === "outdated"
        ? "text-[color:var(--danger)]"
        : "text-[color:var(--warning)]";
  const validationToneClass =
    validationStatus === "approved" ? "text-[color:var(--success)]" : "text-[color:var(--warning)]";

  const cards: Array<{ title: string; line: string; lineClassName: string; detail: string }> = [
    {
      title: "Source status",
      line: differentialSourceStatusLabel(sourceStatus),
      lineClassName: sourceToneClass,
      detail: source.sourceTitle || source.reviewStatus,
    },
    {
      title: "Review status",
      line: differentialValidationStatusLabel(validationStatus),
      lineClassName: validationToneClass,
      detail: "Use clinical judgement and local protocols.",
    },
    {
      title: "Version",
      line: `${source.version} | Local content only`,
      lineClassName: "text-[color:var(--text-heading)]",
      detail: `Exported ${formatExportedDate(source.exportedAt)}. Data not provided for clinical use.`,
    },
  ];

  return (
    <div className="grid gap-3">
      <section className="grid gap-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 text-xs shadow-[var(--shadow-inset)] sm:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.title}
            className="min-w-0 sm:border-l sm:border-[color:var(--border)] sm:pl-4 first:sm:border-l-0 first:sm:pl-0"
          >
            <p className="font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">{card.title}</p>
            <p className={cn("mt-3 font-bold", card.lineClassName)}>{card.line}</p>
            <p className="mt-2 leading-5 text-[color:var(--text-muted)]">{card.detail}</p>
          </div>
        ))}
      </section>
      {hasCuratedContent(curated) ? (
        <p
          data-testid="differential-authored-content-note"
          className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-inset)] px-4 py-3 text-xs leading-5 text-[color:var(--text-muted)]"
        >
          This record carries locally authored content alongside the exported source material. It is marked &ldquo;
          {curatedProvenanceFor(curated)}&rdquo; wherever it appears, and is not an extract from an indexed source.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The record's one action row, under the title at every width: Compare (into
 * the prefilled compare queue), Copy after review, and Save.
 *
 * @param record - The diagnosis record being shown.
 * @param saved - Whether the diagnosis is currently saved.
 * @param onToggleSaved - Called when the saved state is toggled.
 * @param compareHref - Where the Compare control navigates.
 * @param compareCount - How many diagnoses the compare queue will hold.
 */
function RecordActionRow({
  record,
  saved,
  onToggleSaved,
  compareHref,
  compareCount,
}: {
  record: DifferentialRecord;
  saved: boolean;
  onToggleSaved: () => void;
  compareHref: string;
  compareCount: number;
}) {
  return (
    <>
      <Link href={compareHref} className={buttonFaceClass({ variant: "secondary" })}>
        <GitCompareArrows className="h-4 w-4" aria-hidden />
        Compare ({compareCount})
      </Link>
      <CopyAfterReviewButton
        label="Copy"
        text={formatDifferentialCopyText(record)}
        className={buttonFaceClass({ variant: "secondary" })}
      />
      <button
        type="button"
        onClick={onToggleSaved}
        aria-pressed={saved}
        aria-label={saved ? "Remove saved diagnosis" : "Save diagnosis"}
        className={cn(
          buttonFaceClass({ variant: "secondary" }),
          "w-tap px-0",
          saved &&
            "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
        )}
      >
        {saved ? <BookmarkCheck className="h-4 w-4" aria-hidden /> : <Bookmark className="h-4 w-4" aria-hidden />}
      </button>
    </>
  );
}

function DiagnosisDiscoveryActions({
  sections,
  onSelect,
}: {
  sections: ReturnType<typeof buildDifferentialSectionIndex>;
  onSelect: (id: "map" | "related") => void;
}) {
  const actions = [
    {
      id: "map" as const,
      label: "Map",
      detail: sections.find((section) => section.id === "map")?.detail ?? "View links",
      icon: Waypoints,
    },
    {
      id: "related" as const,
      label: "Related",
      detail: sections.find((section) => section.id === "related")?.detail ?? "View items",
      icon: Share2,
    },
  ];

  return (
    <nav aria-label="Explore diagnosis" data-testid="differential-discovery-actions" className="grid gap-2 sm:hidden">
      <h2 className="m-0 text-lg font-bold tracking-tight text-[color:var(--text-heading)]">Explore diagnosis</h2>
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => onSelect(action.id)}
              className="group grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-[color:var(--border-lux)] bg-[color:var(--surface)] p-2.5 text-left shadow-[var(--shadow-inset)] transition-colors hover:border-[color:var(--clinical-accent-border)] hover:bg-[color:var(--clinical-accent-soft)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              <span className="grid size-9 place-items-center rounded-md bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-[color:var(--text-heading)]">{action.label}</span>
                <span className="block truncate text-xs font-medium text-[color:var(--text-muted)]">
                  {action.detail}
                </span>
              </span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)] group-hover:text-[color:var(--clinical-accent)]"
                aria-hidden
              />
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Body of the header's ellipsis sheet. This is where the page actions live now
 * that the header's right slot is a single actions control — including "New
 * differentials search", which used to be a bare `+` in the old header row.
 */
function DiagnosisActions({
  record,
  saved,
  onToggleSaved,
  compareHref,
  compareCount,
  onNavigate,
}: {
  record: DifferentialRecord;
  saved: boolean;
  onToggleSaved: () => void;
  compareHref: string;
  compareCount: number;
  onNavigate: () => void;
}) {
  return (
    <div className="grid gap-2">
      <Link href={compareHref} onClick={onNavigate} className={actionRowClass}>
        <GitCompareArrows className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
        Compare ({compareCount})
      </Link>
      <CopyAfterReviewButton
        label="Copy after review"
        text={formatDifferentialCopyText(record)}
        className={cn(
          actionRowClass,
          "justify-start !bg-[color:var(--surface-subtle)] !text-[color:var(--text-heading)]",
        )}
      />
      <button type="button" onClick={onToggleSaved} aria-pressed={saved} className={actionRowClass}>
        {saved ? (
          <BookmarkCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
        ) : (
          <Bookmark className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
        )}
        {saved ? "Remove saved diagnosis" : "Save diagnosis"}
      </button>
      <Link href={appModeHomeHref("differentials", { focus: true })} onClick={onNavigate} className={actionRowClass}>
        <Plus className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
        New differentials search
      </Link>
    </div>
  );
}

/**
 * The `sm+` section rail.
 *
 * Shape borrowed wholesale from `SegmentedControl` — same inset well, radius,
 * gap and accent-soft selected segment — so this reads as the one-of-N rail the
 * rest of the app already uses, rather than a sixth bespoke tab. What it is
 * NOT is a `SegmentedControl`: that primitive is a `radiogroup`, and these
 * buttons own labelled panels, so the ARIA tabs pattern is the correct
 * semantic and is kept exactly as it was.
 *
 * Labels, icons and order all come from the same `buildDifferentialSectionIndex`
 * array that feeds the header's section sheet and the weighted track, so the
 * three affordances cannot drift apart.
 *
 * Not sticky. `docs/search-chrome-behaviour.md` allows one chrome owner per
 * page and the in-page header already is it; a second bar pinned underneath it
 * would be a second owner, and the header's section disclosure already reaches
 * every tab while scrolled.
 */
function Tabs({
  sections,
  active,
  counts,
  onChange,
}: {
  sections: DifferentialDetailSection[];
  active: DifferentialDetailTabId;
  counts: Record<DifferentialDetailTabId, number | null>;
  onChange: (id: DifferentialDetailTabId) => void;
}) {
  const tabRefs = useRef(new Map<DifferentialDetailTabId, HTMLButtonElement>());

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const order = sections.map((section) => section.id);
    const index = order.indexOf(active);
    const next =
      event.key === "ArrowRight"
        ? order[(index + 1) % order.length]
        : event.key === "ArrowLeft"
          ? order[(index - 1 + order.length) % order.length]
          : event.key === "Home"
            ? order[0]
            : event.key === "End"
              ? order[order.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    if (next === active) return;
    onChange(next);
    tabRefs.current.get(next)?.focus();
  }

  return (
    <nav
      role="tablist"
      onKeyDown={handleKeyDown}
      // Phones navigate from the header disclosure and its sheet instead — one
      // affordance per breakpoint, and no strip to clip at 320px.
      className="hidden w-full min-w-0 gap-0.5 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-1 shadow-[var(--shadow-inset)] sm:flex"
      aria-label="Diagnosis sections"
    >
      {sections.map((tab) => {
        const isActive = tab.id === active;
        const Icon = tab.icon;
        const count = counts[tab.id];
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) tabRefs.current.set(tab.id, element);
              else tabRefs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`differential-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`differential-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "focus-ring-tab relative flex min-h-tap min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-sm font-semibold transition md:px-3",
              // Selected state matches `SegmentedControl` exactly, including
              // keeping the same inset elevation as the well it sits in. A
              // raised pill inside an inset well is an elevation inversion,
              // which `check:design-system-contract` fails on.
              isActive
                ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)] shadow-[var(--shadow-inset)]"
                : "border-transparent text-[color:var(--text-muted)] hover:bg-[color:var(--surface-highlight)] hover:text-[color:var(--text-heading)]",
            )}
          >
            {Icon ? (
              <Icon
                className={cn(
                  "size-icon-sm shrink-0",
                  isActive ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--decoration-soft)]",
                )}
                aria-hidden
              />
            ) : null}
            {tab.label}
            {typeof count === "number" ? (
              // `nums` keeps the figures tabular so the pill does not twitch
              // between records; `sr-only` is not used because the number is
              // part of what the tab means, not decoration.
              <span
                className={cn(
                  "nums rounded-md px-1 text-2xs font-bold",
                  isActive
                    ? "bg-[color:var(--surface)] text-[color:var(--clinical-accent)]"
                    : "text-[color:var(--text-muted)]",
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function DifferentialDetailPage({
  record: exportedRecord,
  detailContext,
  liveGovernance = null,
}: {
  record: DifferentialRecord;
  detailContext: DifferentialDetailContext;
  liveGovernance?: DifferentialRecordGovernance | null;
}) {
  const curated = detailContext.curated ?? null;
  // Applied here as well as in the catalogue loader, not instead of it. The
  // loader covers every record built from the snapshot; this covers a record
  // handed to the page from anywhere else, including a live owner row read back
  // from Supabase that was seeded before the withhold existed. The call is
  // idempotent and returns non-withheld records by identity, so the duplication
  // costs nothing and closes the one path the loader cannot see.
  const bodyWithheld = generatedBodyWithheld(curated);
  const record = useMemo(() => withholdGeneratedBody(exportedRecord, curated), [curated, exportedRecord]);
  const [activeTab, setActiveTab] = useState<DifferentialDetailTabId>("overview");
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set<string>());
  const accountData = useAccountData();
  const saved = accountData.isSaved("differential", record.slug);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const sections = useMemo(
    () => buildDifferentialSectionIndex(record, detailContext, liveGovernance?.sourceStatus ?? null),
    [detailContext, liveGovernance?.sourceStatus, record],
  );
  const activeSection = sections.find((section) => section.id === activeTab) ?? sections[0];
  // Capped at the picker's slot count, this diagnosis first. Beyond that the
  // queue's own padding truncates, so a prefilled ninth id would vanish the
  // moment the reader opened "Edit selection" and be committed away on the next
  // edit — a silent loss rather than a visible one.
  const compareIds = useMemo(
    () => [record.slug, ...(detailContext.knownRelatedSlugs ?? [])].slice(0, COMPARE_MAX_COUNT),
    [detailContext.knownRelatedSlugs, record.slug],
  );
  const compareHref = idsCompareHref("/differentials/compare", compareIds);
  const tabCounts = useMemo(() => detailTabCounts(record, compareIds.length), [compareIds.length, record]);
  const sourceStatus = liveGovernance?.sourceStatus ?? detailContext.source.sourceStatus;

  const expandableSectionIds = useMemo(
    () =>
      record.sections.filter((section) => visibleSectionItems(section, record).length > 0).map((section) => section.id),
    [record],
  );
  const allOpen = expandableSectionIds.length > 0 && expandableSectionIds.every((id) => openSections.has(id));

  useEffect(() => {
    // One-time URL -> state sync after mount; the route stays statically
    // generated because it never reads useSearchParams/searchParams.
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param && isDetailTabId(param)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(param);
    }
  }, []);

  const changeTab = useCallback((id: DifferentialDetailTabId) => {
    setActiveTab(id);
    const url = new URL(window.location.href);
    if (id === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }, []);

  // The onward actions sit at the foot of a tab, so switching from there
  // starts the new tab at its heading and brings the top bar back.
  const changeTabFromFoot = useCallback(
    (id: DifferentialDetailTabId) => {
      changeTab(id);
      document.getElementById("main-content")?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    },
    [changeTab],
  );

  const setSectionOpen = useCallback((id: string, open: boolean) => {
    setOpenSections((previous) => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  function toggleAllSections() {
    setOpenSections(allOpen ? new Set() : new Set(expandableSectionIds));
  }

  async function toggleSaved() {
    try {
      const nowSaved = !saved;
      const updated = await accountData.setFavourite("differential", record.slug, nowSaved);
      if (!updated) {
        setSaveNotice(
          accountData.isAuthenticated ? "Save failed. Try again." : "Sign in or create an account to save diagnoses.",
        );
        return;
      }
      setSaveNotice(nowSaved ? "Diagnosis saved." : "Diagnosis removed from saved items.");
    } catch {
      setSaveNotice("Save failed.");
    }
  }

  // One tap, and it says where it goes. "Compare (4)" on a primary button reads
  // as "open the comparison"; it used to open a tab carrying its own button to
  // actually open one. The ids are this diagnosis plus the related diagnoses
  // that resolve to a reviewed page, which is also what the count must say — the
  // record's full `related` list includes nodes with no page, and the queue drops
  // them, so counting those promised rows that never arrive.

  return (
    <main
      data-testid="differential-detail-page"
      className="min-h-dvh bg-[color:var(--background)] pb-24 text-[color:var(--text)] lg:pb-6"
    >
      <InPageNavHeader
        back={{ href: "/differentials/diagnoses", label: "Diagnoses" }}
        title={record.title}
        sections={sections}
        activeId={activeTab}
        onSelectSection={(id) => {
          if (isDetailTabId(id)) changeTab(id);
        }}
        actionsNoun="diagnosis"
        actionsDescription="Choose how to use this differential."
        testIdPrefix="differential"
        actions={(close) => (
          <DiagnosisActions
            record={record}
            saved={saved}
            onToggleSaved={() => {
              close();
              void toggleSaved();
            }}
            compareHref={compareHref}
            compareCount={compareIds.length}
            onNavigate={close}
          />
        )}
      />
      <div className={cn(pageContainer, "grid gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8")}>
        <RecordIntro
          title={record.title}
          line={record.subtitle}
          tags={
            <>
              <span
                className={cn(
                  "inline-flex min-h-7 items-center rounded-md border px-2.5 text-xs font-extrabold uppercase",
                  statusToneClass[record.status],
                )}
              >
                {differentialStatusLabel(record.status)}
              </span>
              <span className="inline-flex min-h-7 items-center gap-1.5 text-xs font-semibold text-[color:var(--text-muted)]">
                <StatusMark status={sourceStatus} />
                {differentialSourceStatusLabel(sourceStatus)}
              </span>
            </>
          }
          actions={
            <RecordActionRow
              record={record}
              saved={saved}
              onToggleSaved={toggleSaved}
              compareHref={compareHref}
              compareCount={compareIds.length}
            />
          }
        />

        {saveNotice ? (
          <p role="status" aria-live="polite" className="text-sm text-[color:var(--text-muted)]">
            {saveNotice}
          </p>
        ) : null}

        <Tabs sections={sections} active={activeTab} counts={tabCounts} onChange={changeTab} />

        {/* Named by its own label rather than by the tab button: below `sm` the
            strip is `display:none`, and assistive tech ignores a hidden
            `aria-labelledby` target, which would leave the panel unnamed. */}
        <div
          role="tabpanel"
          id={`differential-panel-${activeTab}`}
          aria-label={activeSection?.label ?? "Diagnosis section"}
          className="grid gap-4"
        >
          {activeTab === "overview" ? (
            // Two columns from `lg` only. The phone layout of this page is
            // already settled and its geometry is pinned by the Chromium spec;
            // the rail is desktop breathing room, not a fourth phone summary.
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-5">
              {/* `grid-cols-1` is load-bearing, not decoration: an implicit `auto` track
                  sizes to its widest item's min-content, which the Safety snapshot's
                  horizontally scrollable "Watch for" row drives to 493px. Below `sm`
                  that overflowed the 366px column and `#main-content`'s `overflow-x: clip`
                  swallowed the remainder — truncating EMERGENT safety text mid-word with
                  no ellipsis, scrollbar or any other cue that content was missing.
                  `repeat(1, minmax(0, 1fr))` caps the track at the column; measured
                  identical at 639px and above. */}
              <RecordBody className="grid grid-cols-1">
                <SafetyGlance record={record} curated={curated} />
                <SafetySnapshot record={record} termLinks={detailContext.termLinks ?? {}} />
                <ContentNote curated={curated} />
                <ClinicalHinge record={record} />
                <PhoneDoNow record={record} curated={curated} />
                <RecordSection
                  title="Clinical review"
                  action={
                    expandableSectionIds.length > 0 ? (
                      <button
                        type="button"
                        data-testid="differential-expand-all"
                        onClick={toggleAllSections}
                        className="inline-flex min-h-tap items-center gap-1.5 text-xs font-semibold text-[color:var(--clinical-accent)] hover:text-[color:var(--primary-strong)]"
                      >
                        {allOpen ? (
                          <ChevronsDownUp className="h-4 w-4" aria-hidden />
                        ) : (
                          <ChevronsUpDown className="h-4 w-4" aria-hidden />
                        )}
                        {allOpen ? "Collapse all" : "Expand all"}
                      </button>
                    ) : null
                  }
                >
                  <div className="border-t border-[color:var(--border)]">
                    {!bodyWithheld && record.sections.some((section) => sectionScopeLabel(section, record)) ? (
                      <p
                        data-testid="differential-group-scope-note"
                        className="border-b border-[color:var(--border)] px-3 py-2 text-xs leading-5 text-[color:var(--text-muted)] sm:px-4"
                      >
                        Rows marked “Whole group”: {differentialGroupScopeNote(record)}
                      </p>
                    ) : null}
                    {bodyWithheld ? (
                      <WithheldBody onOpenSource={() => changeTab("source")} />
                    ) : (
                      record.sections.map((section) => (
                        <SectionRow
                          key={section.id}
                          section={section}
                          record={record}
                          open={openSections.has(section.id)}
                          onOpenChange={setSectionOpen}
                          termLinks={detailContext.termLinks ?? {}}
                        />
                      ))
                    )}
                  </div>
                </RecordSection>
                {/* Map and Related, the record's onward journeys, close the
                    phone record (the strip is phone-only; tabs carry them from sm). */}
                <DiagnosisDiscoveryActions sections={sections} onSelect={changeTabFromFoot} />
              </RecordBody>
              <DifferentialOverviewRail
                record={record}
                detailContext={detailContext}
                liveGovernance={liveGovernance}
                onOpenSource={() => changeTab("source")}
              />
            </div>
          ) : null}

          {activeTab === "compare" ? <ComparePanel record={record} detailContext={detailContext} /> : null}

          {activeTab === "map" ? (
            <DiagnosisMapPanel
              key={record.slug}
              record={record}
              relatedMapDetails={detailContext.relatedMapDetails}
              knownRelatedSlugs={detailContext.knownRelatedSlugs}
              curated={curated}
            />
          ) : null}

          {activeTab === "related" ? (
            <>
              <RelatedDiagnoses record={record} knownRelatedSlugs={detailContext.knownRelatedSlugs} />
              <CurrentPresentation record={record} />
            </>
          ) : null}

          {activeTab === "source" ? (
            <FooterStatus source={detailContext.source} liveGovernance={liveGovernance} curated={curated} />
          ) : null}

          {/* Overview closes with these itself; every other tab keeps Map and
              Related one tap away on a phone. */}
          {activeTab !== "overview" ? (
            <DiagnosisDiscoveryActions sections={sections} onSelect={changeTabFromFoot} />
          ) : null}
        </div>

        <p className="rounded-lg border border-transparent px-1 text-xs leading-5 text-[color:var(--text-muted)]">
          Clinical reference — not validated decision support. Review before use.
        </p>
      </div>
    </main>
  );
}
