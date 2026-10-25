import Link from "next/link";
import { Fragment } from "react";
import {
  Activity,
  BrainCircuit,
  CircleCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  GitCompareArrows,
  MoreHorizontal,
  ShieldAlert,
  Stethoscope,
  type LucideIcon,
} from "lucide-react";

import { DiagnosisTermChip, DiagnosisTermInlineList } from "@/components/differentials/diagnosis-term-link";
import { CopyAfterReviewButton } from "@/components/differentials/differential-presentation-actions";
import { PhoneFooterLayerPortal } from "@/components/clinical-dashboard/phone-footer-layer-portal";
import { RegistryModeNav } from "@/components/mode-nav/registry-mode-nav";
import { cn } from "@/components/ui-primitives";
import {
  buildDiagnosisTitleSlugMap,
  isClinicalHingeLabel,
  resolveDiagnosisTermSegments,
  type ResolveDiagnosisTermOptions,
} from "@/lib/differential-diagnosis-links";
import {
  AD_HOC_DIFFERENTIAL_COMPARE_ID,
  acuteConfusionPresentationWorkflow,
  getDifferentialRecord,
  getPresentationWorkflow,
  type DifferentialComparisonCriterion,
  type DifferentialPresentationWorkflow,
  type DifferentialRecord,
  type DifferentialSection,
} from "@/lib/differentials";
import { differentialCompareSearchHref } from "@/lib/differentials-navigation";

/** Criteria whose cells are typically diagnosis-name lists rather than free prose. */
const DIAGNOSIS_NAME_LIST_CRITERIA = new Set(["mimics-overlap", "what-argues-against", "must-not-miss"]);

function ComparisonCellContent({
  criterionId,
  value,
  diagnosisLinks,
}: {
  criterionId: string;
  value: string;
  diagnosisLinks?: ResolveDiagnosisTermOptions;
}) {
  if (!DIAGNOSIS_NAME_LIST_CRITERIA.has(criterionId)) {
    return <>{value}</>;
  }
  const segments = resolveDiagnosisTermSegments(value, diagnosisLinks);
  if (segments.length === 0) return <>{value}</>;
  if (segments.length === 1 && !segments[0]?.slug) return <>{value}</>;
  return <DiagnosisTermInlineList segments={segments} />;
}

type CandidateView = {
  record: DifferentialRecord;
  selected: boolean;
  comparison: Record<string, string>;
};

const criterionIcon: Record<DifferentialSection["tone"], LucideIcon> = {
  fit: CircleCheck,
  warning: ShieldAlert,
  question: CircleHelp,
  action: Activity,
  test: FlaskConical,
  overlap: MoreHorizontal,
};

const criterionTone: Record<DifferentialSection["tone"], string> = {
  fit: "border-[color:var(--success-border)] bg-[color:var(--success-soft)] text-[color:var(--success)]",
  warning: "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]",
  question: "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]",
  action:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  test: "border-[color:var(--info-border)] bg-[color:var(--info-soft)] text-[color:var(--info)]",
  overlap: "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
};

// Every tone is OPAQUE (#0FT00E). The sticky criteria cell takes `bg-inherit`
// from its row, so an alpha tone such as `/75` let horizontally scrolled cells
// bleed through the red-flag row labels. Mixing the soft tone into the surface
// keeps the same visible tint without any transparency.
const rowTone: Record<DifferentialSection["tone"], string> = {
  fit: "bg-[color:var(--surface)]",
  warning: "bg-[color:color-mix(in_srgb,var(--danger-soft)_75%,var(--surface))]",
  question: "bg-[color:var(--surface)]",
  action: "bg-[color:color-mix(in_srgb,var(--clinical-accent-soft)_55%,var(--surface))]",
  test: "bg-[color:var(--surface)]",
  overlap: "bg-[color:var(--surface)]",
};

/**
 * The table's minimum width by candidate-column count: the 10.75rem criteria
 * column plus 8.5rem per candidate. A fixed lookup of LITERAL classes, because
 * Tailwind only generates classes it can read in the source (#0FT00E). It
 * replaces a flat `min-w-[84rem]`, which forced 1344px however few columns
 * there were. Not `w-max`: the "Applies to the whole presentation" cell spans
 * every column, and max-content would size the table to that sentence on one
 * line. Not an inline style: the design drift ratchet is at its ceiling.
 */
const comparisonTableMinWidth = [
  "min-w-[10.75rem]",
  "min-w-[19.25rem]",
  "min-w-[27.75rem]",
  "min-w-[36.25rem]",
  "min-w-[44.75rem]",
  "min-w-[53.25rem]",
  "min-w-[61.75rem]",
  "min-w-[70.25rem]",
  "min-w-[78.75rem]",
  "min-w-[87.25rem]",
  "min-w-[95.75rem]",
  "min-w-[104.25rem]",
  "min-w-[112.75rem]",
] as const;

function comparisonTableMinWidthClass(candidateCount: number) {
  const index = Math.max(0, Math.min(candidateCount, comparisonTableMinWidth.length - 1));
  return comparisonTableMinWidth[index];
}

/** Selected diagnoses first, each group in catalogue order, so the columns the
 *  banner says are being compared are the ones in view (#0FT00E). */
function selectedFirst(candidates: readonly CandidateView[]) {
  return [
    ...candidates.filter((candidate) => candidate.selected),
    ...candidates.filter((candidate) => !candidate.selected),
  ];
}

function NotSelectedMarker() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-md border border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface)] px-2 text-2xs font-bold leading-none text-[color:var(--text-muted)]">
      Not selected
    </span>
  );
}

function statusLabel(status: DifferentialRecord["status"]) {
  if (status === "emergent") return "Emergency";
  if (status === "urgent") return "Urgent";
  return "Routine";
}

function statusClassName(status: DifferentialRecord["status"]) {
  if (status === "emergent") {
    return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)] text-[color:var(--danger)]";
  }
  if (status === "urgent") {
    return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] text-[color:var(--warning)]";
  }
  return "border-[color:var(--border)] bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]";
}

const urgencyRank: Record<DifferentialRecord["status"], number> = { emergent: 2, urgent: 1, routine: 0 };

/** The Highest urgency box's tone; neutral when nothing is selected. */
function urgencyBoxClassName(status: DifferentialRecord["status"] | null) {
  if (status === "emergent") return "border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]/80";
  if (status === "urgent") return "border-[color:var(--warning-border)] bg-[color:var(--warning-soft)]/80";
  return "border-[color:var(--border)] bg-[color:var(--surface-subtle)]";
}

function CandidateGlyph({ record, className }: { record: DifferentialRecord; className?: string }) {
  if (record.slug.includes("substance")) return <FlaskConical className={className} aria-hidden />;
  if (record.slug.includes("post-ictal")) return <Activity className={className} aria-hidden />;
  if (record.slug.includes("hepatic")) return <Stethoscope className={className} aria-hidden />;
  if (record.slug.includes("meningitis")) return <ShieldAlert className={className} aria-hidden />;
  return <BrainCircuit className={className} aria-hidden />;
}

function comparisonCopy(workflow: DifferentialPresentationWorkflow, candidates: CandidateView[]) {
  const criterionScope = new Map((workflow.criteria ?? []).map((criterion) => [criterion.id, criterion.scope]));
  const qualify = (criterionId: string, value: string, diagnosisTitle: string) => {
    if (criterionScope.get(criterionId) !== "presentation") return value;
    return `${value} (presentation group, not specific to ${diagnosisTitle})`;
  };
  return [
    `${workflow.title} comparison`,
    workflow.safetySnapshot.summary,
    "",
    ...candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => {
        const title = candidate.record.title;
        const mustNotMiss = qualify(
          "must-not-miss",
          candidate.comparison["must-not-miss"] ?? "Review must-not-miss risks.",
          title,
        );
        const action = qualify(
          "immediate-action",
          candidate.comparison["immediate-action"] ?? "Review immediate action.",
          title,
        );
        return `${title} (${statusLabel(candidate.record.status)}): ${mustNotMiss} Immediate action: ${action}`;
      }),
  ].join("\n");
}

function getCandidates(
  workflow: DifferentialPresentationWorkflow,
  records?: readonly DifferentialRecord[],
): CandidateView[] {
  return workflow.candidates.flatMap((candidate) => {
    const record =
      records === undefined
        ? getDifferentialRecord(candidate.slug)
        : records.find((record) => record.slug === candidate.slug);
    if (!record) return [];
    return [
      {
        record,
        selected: candidate.selected,
        comparison: candidate.comparison,
      },
    ];
  });
}

function EmergencyBadge({ status }: { status: DifferentialRecord["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-md border px-2 text-2xs font-extrabold uppercase leading-none",
        statusClassName(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

/**
 * A criterion whose answer is the presentation group's, not each diagnosis's.
 *
 * Five of the seven comparison criteria carry the identical group value for every
 * candidate. Laying them out per diagnosis made the acute dystonia column assert
 * the akathisia bedside question and a thyroid workup as facts about acute
 * dystonia. Those rows are rendered once as shared context instead. See
 * `withPresentationScope()` in `src/lib/differentials.ts` and
 * `tests/differentials-presentation-scope.test.ts`.
 */
function isGroupScopedCriterion(criterion: DifferentialComparisonCriterion) {
  return criterion.scope === "presentation";
}

/** The single value a group-scoped criterion holds, or null if candidates differ. */
function groupScopedValue(criterion: DifferentialComparisonCriterion, candidates: readonly CandidateView[]) {
  if (!isGroupScopedCriterion(criterion)) return null;
  const values = candidates.map((candidate) => candidate.comparison[criterion.id]?.trim()).filter(Boolean);
  if (values.length === 0 || new Set(values).size !== 1) return null;
  return values[0]!;
}

function CriteriaLabel({ criterion }: { criterion: DifferentialComparisonCriterion }) {
  const Icon = criterionIcon[criterion.tone];
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span
        className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full border", criterionTone[criterion.tone])}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="min-w-0 text-sm-minus font-extrabold leading-4 text-[color:var(--text-heading)]">
        {criterion.title}
      </span>
    </span>
  );
}

function CandidateHeader({ candidate }: { candidate: CandidateView }) {
  return (
    <Link
      href={`/differentials/diagnoses/${candidate.record.slug}`}
      className="group grid min-h-[4.8rem] min-w-[8.5rem] content-start justify-items-center gap-1.5 px-2 py-2.5 text-center hover:bg-[color:var(--surface-subtle)]"
    >
      <CandidateGlyph
        record={candidate.record}
        className="h-5 w-5 text-[color:var(--text-muted)] group-hover:text-[color:var(--clinical-accent)]"
      />
      <span className="max-w-[7.5rem] text-balance text-xs font-extrabold leading-tight text-[color:var(--text-heading)]">
        {candidate.record.title}
      </span>
      <EmergencyBadge status={candidate.record.status} />
      {candidate.selected ? null : <NotSelectedMarker />}
    </Link>
  );
}

function DesktopComparisonTable({
  workflow,
  diagnosisLinks,
  candidates,
  editSelectionHref,
}: {
  workflow: DifferentialPresentationWorkflow;
  diagnosisLinks?: ResolveDiagnosisTermOptions;
  candidates: CandidateView[];
  editSelectionHref: string;
}) {
  const columns = selectedFirst(candidates);
  return (
    <section className="hidden md:block" aria-label="Differential comparison table">
      <div className="mb-2 flex min-h-tap flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CircleCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
          <p className="text-sm font-semibold text-[color:var(--text-muted)]">
            <span className="font-extrabold text-[color:var(--text-heading)]">{workflow.selectedCount}</span> of{" "}
            {workflow.totalCount} diagnoses compared
          </p>
        </div>
        <Link
          href={editSelectionHref}
          data-testid="differential-presentation-edit-selection-desktop"
          className="inline-flex min-h-tap items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--surface)]"
        >
          Edit selection
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div
        data-testid="differential-comparison-scroll"
        className="polished-scroll @container overflow-x-auto rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e2)]"
      >
        <table
          aria-label="Differential comparison"
          className={cn(
            "w-full border-separate border-spacing-0 text-left",
            comparisonTableMinWidthClass(columns.length),
          )}
        >
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-10 w-[10.75rem] border-b border-r border-[color:var(--border)] bg-[color:var(--clinical-chat-table-header)] px-3.5 py-3 align-top text-xs font-extrabold uppercase text-[color:var(--text-muted)]"
              >
                Criteria
                <span className="mt-1.5 block text-2xs font-bold normal-case text-[color:var(--text-muted)]">
                  Comparison detail
                </span>
              </th>
              {columns.map((candidate) => (
                <th
                  scope="col"
                  key={candidate.record.slug}
                  className={cn(
                    "w-[8.5rem] border-b border-r border-[color:var(--border)] bg-[color:var(--clinical-chat-table-header)] p-0 align-top",
                    !candidate.selected && "bg-[color:var(--surface-subtle)]",
                  )}
                >
                  <CandidateHeader candidate={candidate} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workflow.criteria.map((criterion) => {
              const shared = groupScopedValue(criterion, columns);
              return (
                <tr key={criterion.id} className={rowTone[criterion.tone]}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 w-[10.75rem] border-b border-r border-[color:var(--border)] bg-inherit px-3.5 py-3 align-top"
                  >
                    <CriteriaLabel criterion={criterion} />
                  </th>
                  {shared ? (
                    // One cell across every column: this answer belongs to the
                    // group, so it must not sit under any one diagnosis.
                    <td
                      colSpan={columns.length}
                      className="border-b border-r border-[color:var(--border)] bg-[color:var(--surface-subtle)]/60 px-3 py-3 align-top text-2xs font-semibold leading-normal text-[color:var(--text-muted)]"
                    >
                      {/* The cell spans every candidate column, so it is far wider
                          than the visible table and long answers ran off the
                          right edge. Pin the text beside the criteria column and
                          wrap it to the visible width of the scroll area. */}
                      <div className="sticky left-[11rem] max-w-[calc(100cqw-12.5rem)]">
                        <span className="mb-1 block text-2xs font-extrabold uppercase tracking-wide text-[color:var(--text-muted)]">
                          Applies to the whole presentation
                        </span>
                        <ComparisonCellContent
                          diagnosisLinks={diagnosisLinks}
                          criterionId={criterion.id}
                          value={shared}
                        />
                      </div>
                    </td>
                  ) : (
                    columns.map((candidate) => (
                      <td
                        key={`${candidate.record.slug}-${criterion.id}`}
                        className={cn(
                          "w-[8.5rem] border-b border-r border-[color:var(--border)] px-3 py-3 align-top text-2xs font-semibold leading-normal text-[color:var(--text-muted)]",
                          !candidate.selected && "text-[color:var(--text-muted)]",
                        )}
                      >
                        <ComparisonCellContent
                          diagnosisLinks={diagnosisLinks}
                          criterionId={criterion.id}
                          value={candidate.comparison[criterion.id] ?? "Review locally."}
                        />
                      </td>
                    ))
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs font-medium text-[color:var(--text-muted)]">
        Scroll horizontally to review more candidate differentials. Clinical reference — not validated decision support.
        Review before use.
      </p>
    </section>
  );
}

function SafetySnapshot({
  workflow,
  diagnosisLinks,
}: {
  workflow: DifferentialPresentationWorkflow;
  diagnosisLinks?: ResolveDiagnosisTermOptions;
}) {
  return (
    <section
      className="rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]/85 p-3 shadow-[var(--shadow-inset)] xl:p-4"
      aria-label="Safety snapshot"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--surface)] text-[color:var(--danger)] xl:h-9 xl:w-9">
          <ShieldAlert className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-extrabold uppercase text-[color:var(--danger)]">Safety snapshot</h2>
            <EmergencyBadge status={workflow.status} />
          </div>
          <p className="mt-2 text-sm font-semibold leading-5 text-[color:var(--text-heading)] xl:leading-6">
            {workflow.safetySnapshot.summary}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {workflow.safetySnapshot.tags.map((tag) => {
              if (isClinicalHingeLabel(tag)) {
                return (
                  <span
                    key={tag}
                    className="inline-flex min-h-6 items-center rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-2 text-2xs font-semibold text-[color:var(--text-muted)] xl:min-h-7 xl:text-xs"
                  >
                    {tag}
                  </span>
                );
              }
              const segments = resolveDiagnosisTermSegments(tag, diagnosisLinks);
              return (
                <Fragment key={tag}>
                  {segments.map((segment, index) => (
                    <DiagnosisTermChip
                      key={`${tag}-${segment.text}-${index}`}
                      label={segment.text}
                      slug={segment.slug}
                      tone="danger"
                      // compact-meta (40px), not min-h-tap: sibling in this same
                      // safety-snapshot tag row (line ~305) is a fixed 24-28px
                      // non-interactive hinge-label chip, so a tap-sized primary
                      // here would visibly mismatch the row it belongs to.
                      // TOKENS.md §2's compact-meta role list ("filter chips") is
                      // the closest documented fit for a small reference chip in
                      // a dense tag row (TOKENS.md requires this comment).
                      className="min-h-compact-meta px-2 text-2xs font-bold xl:text-xs"
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function SelectedDifferentialsPanel({
  workflow,
  candidates,
}: {
  workflow: DifferentialPresentationWorkflow;
  candidates: CandidateView[];
}) {
  const selectedCandidates = candidates.filter((candidate) => candidate.selected);
  const remainingCount = Math.max(workflow.totalCount - selectedCandidates.length, 0);
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-extrabold uppercase text-[color:var(--text-muted)]">
          Selected differentials ({selectedCandidates.length} of {workflow.totalCount})
        </h2>
        {remainingCount > 0 ? (
          <span className="text-xs font-bold text-[color:var(--clinical-accent)]">+{remainingCount} not selected</span>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[color:var(--text-muted)]">
        {selectedCandidates.map((candidate) => {
          return (
            <CandidateGlyph key={candidate.record.slug} record={candidate.record} className="h-6 w-6 stroke-[1.7]" />
          );
        })}
      </div>
      <p className="mt-3 text-xs font-medium text-[color:var(--text-muted)]">
        Open a selected differential to review its clinical record.
      </p>
      <ul className="polished-scroll mt-3 max-h-[11rem] overflow-y-auto pr-1">
        {selectedCandidates.map((candidate) => (
          <li
            key={candidate.record.slug}
            className="flex min-h-9 items-center justify-between gap-2 border-t border-[color:var(--border)] py-2 text-sm font-bold text-[color:var(--text-heading)]"
          >
            <Link
              href={`/differentials/diagnoses/${candidate.record.slug}`}
              className="inline-flex min-w-0 items-center gap-2"
            >
              <CircleCheck className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
              <span className="truncate">{candidate.record.title}</span>
            </Link>
            <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--decoration-soft)]" aria-hidden />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HighestUrgencyPanel({
  workflow,
  candidates,
}: {
  workflow: DifferentialPresentationWorkflow;
  candidates: CandidateView[];
}) {
  // The badge and tone follow the most urgent SELECTED diagnosis. A fixed
  // Emergency box over a selection with no emergency overstated it, and an
  // alarm that is wrong some of the time teaches readers to skip it.
  const selected = candidates.filter((candidate) => candidate.selected);
  const highestStatus = selected.reduce<DifferentialRecord["status"] | null>(
    (highest, candidate) =>
      highest === null || urgencyRank[candidate.record.status] > urgencyRank[highest]
        ? candidate.record.status
        : highest,
    null,
  );
  // Every selected diagnosis at that level is listed: an earlier `slice(0, 3)`
  // silently dropped the fourth emergency (post-ictal state on acute confusion)
  // with no cue (#0FT00E follow-up).
  const highest = selected.filter((candidate) => candidate.record.status === highestStatus);
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-sm font-extrabold uppercase text-[color:var(--text-muted)]">Highest urgency</h2>
      <p className="mt-1 text-xs font-medium text-[color:var(--text-muted)]">Based on current selection</p>
      <div
        data-testid="differential-highest-urgency"
        data-status={highestStatus ?? "none"}
        className={cn("mt-3 rounded-lg border p-3", urgencyBoxClassName(highestStatus))}
      >
        {highestStatus ? (
          <>
            <EmergencyBadge status={highestStatus} />
            <ul className="mt-3 grid gap-1.5 text-sm font-semibold text-[color:var(--text-heading)]">
              {highest.map((candidate) => (
                <li key={candidate.record.slug}>
                  <UrgentDiagnosisLink candidate={candidate} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm font-semibold text-[color:var(--text-muted)]">No diagnoses selected.</p>
        )}
        <p className="mt-3 text-sm font-semibold text-[color:var(--text-muted)]">{workflow.highestUrgencyNote}</p>
      </div>
      <UnselectedEmergencies candidates={candidates} testId="differential-unselected-emergencies" className="mt-3" />
    </section>
  );
}

/**
 * Emergencies left out of the selection, listed in full and never truncated
 * (#0FT00E). Their desktop table columns sit after the selected ones, where
 * they scroll out of view, and the phone view renders only the selected cards,
 * so without this block an unselected emergency such as Wernicke
 * encephalopathy would be on no non-scrolling surface at all. Rendered in the
 * Highest urgency callout (tablet and desktop) and in the phone comparison.
 */
function UnselectedEmergencies({
  candidates,
  testId,
  className,
}: {
  candidates: CandidateView[];
  testId: string;
  className?: string;
}) {
  const unselectedEmergent = candidates.filter(
    (candidate) => !candidate.selected && candidate.record.status === "emergent",
  );
  if (unselectedEmergent.length === 0) return null;
  return (
    <div
      data-testid={testId}
      className={cn(
        "rounded-lg border border-[color:var(--danger-border)] bg-[color:var(--danger-soft)]/80 p-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <EmergencyBadge status="emergent" />
        <NotSelectedMarker />
      </div>
      <ul className="mt-3 grid gap-1.5 text-sm font-semibold text-[color:var(--text-heading)]">
        {unselectedEmergent.map((candidate) => (
          <li key={candidate.record.slug}>
            <UrgentDiagnosisLink candidate={candidate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function UrgentDiagnosisLink({ candidate }: { candidate: CandidateView }) {
  return (
    <Link
      href={`/differentials/diagnoses/${candidate.record.slug}`}
      className="inline-flex min-h-tap items-center gap-1 text-[color:var(--text-heading)] underline-offset-2 hover:text-[color:var(--clinical-accent)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      aria-label={`Open diagnosis: ${candidate.record.title}`}
    >
      {candidate.record.title}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--decoration-soft)]" aria-hidden />
    </Link>
  );
}

function ReviewPanel({ workflow }: { workflow: DifferentialPresentationWorkflow }) {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-sm font-extrabold uppercase text-[color:var(--text-muted)]">Review & handoff</h2>
      <ul className="mt-3 grid gap-2">
        {workflow.reviewChecklist.map((item) => (
          <li key={item} className="flex gap-2 text-xs font-bold leading-5 text-[color:var(--text-heading)]">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CopyAfterReviewPanel({ text }: { text: string }) {
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-sm font-extrabold uppercase text-[color:var(--text-muted)]">Copy after review</h2>
      <p className="mt-2 text-sm font-medium leading-6 text-[color:var(--text-muted)]">
        Create a concise comparison summary for documentation or handoff.
      </p>
      <CopyAfterReviewButton text={text} className="mt-3 w-full" />
    </section>
  );
}

/** The review/handoff panels shared by the desktop side rail (stacked) and the
 *  tablet reflow grid below the comparison table. Safety snapshot is rendered
 *  separately so it can lead each layout. */
function ReviewPanels({
  workflow,
  candidates,
}: {
  workflow: DifferentialPresentationWorkflow;
  candidates: CandidateView[];
}) {
  const selectedCandidates = candidates.filter((candidate) => candidate.selected);
  return (
    <>
      <SelectedDifferentialsPanel workflow={workflow} candidates={candidates} />
      <HighestUrgencyPanel workflow={workflow} candidates={candidates} />
      <ReviewPanel workflow={workflow} />
      <CopyAfterReviewPanel text={comparisonCopy(workflow, selectedCandidates)} />
      <SourceStatusPanel workflow={workflow} />
    </>
  );
}

function SourceStatusPanel({ workflow }: { workflow: DifferentialPresentationWorkflow }) {
  const status = workflow.sourceStatus;
  return (
    <section className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-[var(--shadow-inset)]">
      <h2 className="text-sm font-extrabold uppercase text-[color:var(--text-muted)]">Source status</h2>
      <p className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-[color:var(--warning)]">
        <CircleHelp className="h-4 w-4" aria-hidden />
        {status.label}
      </p>
      <p className="mt-2 text-xs font-semibold text-[color:var(--text-muted)]">{status.version}</p>
      <p className="mt-1 text-xs font-semibold text-[color:var(--text-muted)]">Last updated: {status.lastUpdated}</p>
    </section>
  );
}

function MobileCandidateCard({
  workflow,
  diagnosisLinks,
  candidate,
  index,
}: {
  workflow: DifferentialPresentationWorkflow;
  diagnosisLinks?: ResolveDiagnosisTermOptions;
  candidate: CandidateView;
  index: number;
}) {
  return (
    <details
      className="group rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]"
      open={index === 0}
    >
      <summary className="grid min-h-[3.25rem] cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2">
        <span className="grid h-7 w-7 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-sm font-extrabold text-[color:var(--clinical-accent)]">
          {index + 1}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <CandidateGlyph record={candidate.record} className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" />
            <span className="line-clamp-2 break-words text-base font-extrabold leading-5 text-[color:var(--text-heading)]">
              {candidate.record.title}
            </span>
          </span>
        </span>
        <EmergencyBadge status={candidate.record.status} />
        <ChevronDown className="h-4 w-4 text-[color:var(--text-muted)] transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-[color:var(--border)] px-3 pb-2">
        <div className="border-b border-[color:var(--border)] py-2">
          <Link
            href={`/differentials/diagnoses/${candidate.record.slug}`}
            className="inline-flex min-h-tap items-center gap-1 text-sm font-bold text-[color:var(--clinical-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            Open diagnosis record
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
        {workflow.criteria.map((criterion) => {
          // Group-scoped criteria are rendered once by GroupScopedCriteria, not
          // under each diagnosis — see isGroupScopedCriterion.
          if (isGroupScopedCriterion(criterion)) return null;
          const Icon = criterionIcon[criterion.tone];
          return (
            <div
              key={criterion.id}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 border-b border-[color:var(--border)] py-3 last:border-b-0"
            >
              <span
                className={cn("grid h-6 w-6 place-items-center rounded-full border", criterionTone[criterion.tone])}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm-minus font-extrabold text-[color:var(--text-heading)]">{criterion.title}</h3>
                <p className="mt-0.5 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
                  <ComparisonCellContent
                    diagnosisLinks={diagnosisLinks}
                    criterionId={criterion.id}
                    value={candidate.comparison[criterion.id] ?? "Review locally."}
                  />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

/** The criteria whose answer belongs to the group, shown once for the whole set. */
function GroupScopedCriteria({
  workflow,
  candidates,
  diagnosisLinks,
}: {
  workflow: DifferentialPresentationWorkflow;
  candidates: CandidateView[];
  diagnosisLinks?: ResolveDiagnosisTermOptions;
}) {
  const rows = workflow.criteria
    .map((criterion) => ({ criterion, value: groupScopedValue(criterion, candidates) }))
    .filter((row): row is { criterion: DifferentialComparisonCriterion; value: string } => Boolean(row.value));
  if (rows.length === 0) return null;

  return (
    <section
      data-testid="differential-presentation-group-context"
      aria-label="Applies to the whole presentation"
      className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2"
    >
      <h2 className="text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]">
        Applies to the whole presentation, not to one diagnosis
      </h2>
      <div className="mt-1 grid">
        {rows.map(({ criterion, value }) => {
          const Icon = criterionIcon[criterion.tone];
          return (
            <div
              key={criterion.id}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2 border-b border-[color:var(--border)] py-2.5 last:border-b-0"
            >
              <span
                className={cn("grid h-6 w-6 place-items-center rounded-full border", criterionTone[criterion.tone])}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-sm-minus font-extrabold text-[color:var(--text-heading)]">{criterion.title}</h3>
                <p className="mt-0.5 text-sm-minus font-medium leading-5 text-[color:var(--text-muted)]">
                  <ComparisonCellContent diagnosisLinks={diagnosisLinks} criterionId={criterion.id} value={value} />
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function MobileComparison({
  workflow,
  diagnosisLinks,
  candidates,
  editSelectionHref,
}: {
  workflow: DifferentialPresentationWorkflow;
  diagnosisLinks?: ResolveDiagnosisTermOptions;
  candidates: CandidateView[];
  editSelectionHref: string;
}) {
  const selected = candidates.filter((candidate) => candidate.selected);
  return (
    <section className="grid gap-3 md:hidden" aria-label="Mobile differential comparison">
      <div className="flex min-h-tap items-center justify-between gap-3 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-muted)]">
          <BrainCircuit className="h-4 w-4 shrink-0 text-[color:var(--clinical-accent)]" aria-hidden />
          <span>
            <strong className="font-extrabold text-[color:var(--text-heading)]">{workflow.selectedCount}</strong> of{" "}
            {workflow.totalCount} compared
          </span>
        </span>
        <Link
          href={editSelectionHref}
          data-testid="differential-presentation-edit-selection-mobile"
          className="inline-flex min-h-tap shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-bold text-[color:var(--clinical-accent)] transition hover:bg-[color:var(--surface)]"
        >
          Edit
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <SafetySnapshot workflow={workflow} diagnosisLinks={diagnosisLinks} />
      <UnselectedEmergencies candidates={candidates} testId="differential-unselected-emergencies-mobile" />
      <GroupScopedCriteria workflow={workflow} candidates={selected} diagnosisLinks={diagnosisLinks} />
      <div className="grid gap-3">
        {selected.map((candidate, index) => (
          <MobileCandidateCard
            key={candidate.record.slug}
            workflow={workflow}
            candidate={candidate}
            index={index}
            diagnosisLinks={diagnosisLinks}
          />
        ))}
      </div>
      <PhoneFooterLayerPortal>
        <div
          role="group"
          aria-label="Differential comparison actions"
          data-testid="differential-presentation-phone-footer"
          className="phone-footer-layer inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 rounded-t-xl border-t border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent)] p-1.5 pb-[calc(0.4rem+var(--safe-area-bottom))] shadow-[var(--shadow-elevated)] sm:fixed"
        >
          <span
            aria-current="page"
            className="inline-flex min-h-tap items-center justify-center gap-2 rounded-lg border border-[color:var(--clinical-accent-contrast)]/40 bg-[color:var(--clinical-accent-contrast)]/5 px-2 text-xs font-extrabold text-[color:var(--clinical-accent-contrast)] shadow-[var(--shadow-inset)] sm:text-sm"
          >
            <GitCompareArrows className="h-4 w-4" aria-hidden />
            Comparing ({workflow.selectedCount})
          </span>
          <CopyAfterReviewButton
            text={comparisonCopy(workflow, candidates)}
            className="min-h-tap bg-[color:var(--surface)] px-2 !text-xs !text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-raised)] sm:!text-sm"
          />
        </div>
      </PhoneFooterLayerPortal>
    </section>
  );
}

export function DifferentialPresentationWorkflowPage({
  query = "",
  presentationSlug = "acute-confusion-encephalopathy",
  selectedIds = [],
  workflow: workflowOverride,
  candidateRecords,
}: {
  query?: string;
  presentationSlug?: string;
  selectedIds?: string[];
  /** Prebuilt workflow (ad-hoc or already resolved). When set, skips catalogue slug lookup. */
  workflow?: DifferentialPresentationWorkflow;
  /** Resolved public records. An empty collection never falls back to bundled diagnoses. */
  candidateRecords?: readonly DifferentialRecord[];
}) {
  const baseWorkflow =
    workflowOverride ?? getPresentationWorkflow(presentationSlug) ?? acuteConfusionPresentationWorkflow;
  const requestedIds = new Set(selectedIds.map((id) => id.trim().toLowerCase()).filter(Boolean));
  // Ad-hoc workflows already encode selection; overlay only applies to catalogue presentations.
  const selectedWorkflow =
    workflowOverride?.id === AD_HOC_DIFFERENTIAL_COMPARE_ID
      ? workflowOverride
      : requestedIds.size
        ? (() => {
            let selectedCount = 0;
            const candidates = baseWorkflow.candidates.map((candidate) => {
              const selected = requestedIds.has(candidate.slug);
              if (selected) selectedCount += 1;
              return { ...candidate, selected };
            });
            return { ...baseWorkflow, candidates, selectedCount };
          })()
        : baseWorkflow;
  const candidates = getCandidates(selectedWorkflow, candidateRecords);
  const diagnosisLinks =
    candidateRecords === undefined
      ? undefined
      : {
          titleMap: buildDiagnosisTitleSlugMap(candidateRecords),
          routableSlugs: new Set(candidateRecords.map((record) => record.slug)),
        };
  const missingCandidateCount = selectedWorkflow.candidates.length - candidates.length;
  const workflow =
    missingCandidateCount > 0
      ? {
          ...selectedWorkflow,
          selectedCount: candidates.filter((candidate) => candidate.selected).length,
          totalCount: candidates.length,
          safetySnapshot: {
            ...selectedWorkflow.safetySnapshot,
            summary: `${selectedWorkflow.safetySnapshot.summary} Comparison incomplete: ${missingCandidateCount} diagnosis record(s) are unavailable in the current public catalogue.`,
          },
        }
      : selectedWorkflow;
  const selectedCandidateIds = candidates
    .filter((candidate) => candidate.selected)
    .map((candidate) => candidate.record.slug);
  const modeNavigationParams = new URLSearchParams();
  const trimmedQuery = query.trim();
  if (trimmedQuery) modeNavigationParams.set("q", trimmedQuery);
  // The presentation catalogue can supply a default comparison even when the
  // incoming URL has no ids. The shared header must receive that resolved
  // selection as well, otherwise its Compare link silently opens an empty queue.
  if (selectedCandidateIds.length) modeNavigationParams.set("ids", selectedCandidateIds.join(","));
  const editSelectionHref = differentialCompareSearchHref(query, selectedCandidateIds);

  return (
    <>
      <RegistryModeNav
        modeId="differentials"
        activeId="presentations"
        searchParamString={modeNavigationParams.toString()}
      />
      <main
        data-testid="differential-presentation-page"
        className="min-h-0 overflow-x-clip bg-[color:var(--background)] px-3 pb-[calc(6.25rem+var(--safe-area-bottom))] pt-4 text-[color:var(--text)] sm:grow sm:px-5 md:pb-8 xl:px-7 xl:pt-6"
      >
        <div className="mx-auto grid w-full max-w-[94rem] gap-5 xl:grid-cols-[minmax(0,1fr)_23.5rem]">
          <div className="min-w-0">
            <section className="mb-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <GitCompareArrows className="h-4 w-4 text-[color:var(--clinical-accent)]" aria-hidden />
                  <p className="text-xs font-extrabold uppercase tracking-eyebrow text-[color:var(--clinical-accent)]">
                    Presentation comparison
                  </p>
                  <EmergencyBadge status={workflow.status} />
                </div>
                <h1 className="mt-2 max-w-[58rem] text-balance text-2xl font-extrabold leading-tight text-[color:var(--text-heading)] sm:text-3xl xl:text-2xl-minus">
                  {workflow.title}
                </h1>
                {workflow.scopeLabel ? (
                  <p className="mt-2 max-w-[52rem] text-sm font-bold leading-6 text-[color:var(--text-heading)]">
                    {workflow.scopeLabel}
                  </p>
                ) : null}
                <p className="mt-2 hidden max-w-[48rem] text-sm font-medium leading-6 text-[color:var(--text-muted)] sm:block">
                  {workflow.subtitle}
                </p>
                {query ? (
                  <p className="mt-2 inline-flex max-w-full rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] px-2.5 py-1 text-xs font-bold text-[color:var(--clinical-accent)]">
                    <span className="truncate">Search context: {query}</span>
                  </p>
                ) : null}
              </div>
            </section>

            {missingCandidateCount > 0 ? (
              <p
                role="status"
                className="mb-4 rounded-lg border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3 text-sm"
              >
                Comparison incomplete: {missingCandidateCount} diagnosis record(s) are unavailable in the current public
                catalogue. Review the selection before use.
              </p>
            ) : null}

            {/* Tablet / mid (md–lg): safety leads, then the scrollable table, then
              the review panels reflow into a grid below — no fixed side rail. */}
            <div className="mb-4 hidden md:block xl:hidden">
              <SafetySnapshot workflow={workflow} diagnosisLinks={diagnosisLinks} />
            </div>
            <DesktopComparisonTable
              workflow={workflow}
              candidates={candidates}
              editSelectionHref={editSelectionHref}
              diagnosisLinks={diagnosisLinks}
            />
            <MobileComparison
              workflow={workflow}
              candidates={candidates}
              editSelectionHref={editSelectionHref}
              diagnosisLinks={diagnosisLinks}
            />
            <div className="mt-4 hidden items-start gap-4 md:grid md:grid-cols-2 lg:grid-cols-3 xl:hidden">
              <ReviewPanels workflow={workflow} candidates={candidates} />
            </div>
          </div>

          <aside className="hidden min-w-0 gap-4 xl:grid" aria-label="Differential review sidebar">
            <SafetySnapshot workflow={workflow} diagnosisLinks={diagnosisLinks} />
            <ReviewPanels workflow={workflow} candidates={candidates} />
          </aside>
        </div>

        <div className="mx-auto mt-5 max-w-[94rem] xl:hidden">
          <p className="text-center text-xs font-medium text-[color:var(--text-muted)]">
            Clinical reference — not validated decision support. Review before use.
          </p>
        </div>
      </main>
    </>
  );
}
