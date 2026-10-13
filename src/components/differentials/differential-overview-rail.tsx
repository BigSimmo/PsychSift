"use client";

import Link from "next/link";
import { Activity, ArrowRight, FlaskConical, ShieldAlert, TriangleAlert } from "lucide-react";

import { DiagnosisTermChip } from "@/components/differentials/diagnosis-term-link";
import { cn } from "@/components/ui-primitives";
import { StatusMark } from "@/components/ui/status-mark";
import type { DifferentialRecordGovernance } from "@/components/clinical-dashboard/use-differential-catalog";
import {
  cleanDifferentialItem,
  curatedProvenanceFor,
  differentialGroupScopeNote,
  differentialSourceStatusLabel,
  differentialValidationStatusLabel,
  doNowHeading,
  doNowStepsAreCurated,
  formatExportedDate,
  resolveDoNowSteps,
  type DifferentialDetailContext,
} from "@/lib/differential-detail";
import type { DifferentialRecord } from "@/lib/differentials";

/**
 * The Overview rail: what a clinician needs in the next five minutes, held
 * still while they read the full review beside it.
 *
 * Information only. Compare, Copy after review and Save already have two homes
 * on this page — the header cluster and the in-page header's actions sheet, the
 * second of which is sticky at every width — so a third copy in the rail would
 * be noise rather than convenience.
 *
 * Desktop only, and deliberately so. The phone layout of this page is already
 * settled — the safety snapshot, the "Explore diagnosis" card and the bottom
 * action bar own that width, and their geometry is pinned by
 * `tests/ui-tools.spec.ts`. A rail below `lg` would be a fourth summary of the
 * same record.
 *
 * Every block renders only when it has content. That is not defensive coding
 * for its own sake: of the 201 catalogue records, 150 carry no investigations
 * and 110 carry no immediate actions, so a rail that always drew its headings
 * would show mostly empty cards.
 */

const eyebrowClass = "text-2xs font-extrabold uppercase tracking-eyebrow text-[color:var(--text-muted)]";
const blockClass = "border-t border-[color:var(--border)] p-3.5 first:border-t-0";

function RailBlock({
  title,
  icon: Icon,
  children,
  tone = "neutral",
}: {
  title: string;
  icon: typeof Activity;
  children: React.ReactNode;
  tone?: "neutral" | "accent";
}) {
  return (
    <div className={blockClass}>
      <p className={cn(eyebrowClass, "flex items-center gap-1.5")}>
        <Icon
          className={cn(
            "size-icon-sm shrink-0",
            tone === "accent" ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
          )}
          aria-hidden
        />
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function DifferentialOverviewRail({
  record,
  detailContext,
  liveGovernance = null,
  onOpenSource,
}: {
  record: DifferentialRecord;
  detailContext: DifferentialDetailContext;
  liveGovernance?: DifferentialRecordGovernance | null;
  onOpenSource: () => void;
}) {
  const curated = detailContext.curated ?? null;
  const doNow = resolveDoNowSteps(record, curated);
  const doNowCurated = doNowStepsAreCurated(curated);
  const investigations = record.investigations.map(cleanDifferentialItem).filter(Boolean).slice(0, 5);
  // Immediate actions and investigations are written about the presentation group.
  // Unlabelled, the rail asserts a tremor/thyroid workup of acute dystonia. The
  // wording is shared with the phone card so the two cannot drift.
  const groupScopeNote = differentialGroupScopeNote(record);
  const watchFor = record.safetySnapshot.tags.map(cleanDifferentialItem).filter(Boolean);
  const knownRelated = new Set(detailContext.knownRelatedSlugs);
  const related = record.related.slice(0, 4);
  const termLinks = detailContext.termLinks ?? {};

  const sourceStatus = liveGovernance?.sourceStatus ?? detailContext.source.sourceStatus;
  const validationStatus = liveGovernance?.validationStatus ?? detailContext.source.validationStatus;

  return (
    // `--inpage-sticky-header-height` is the in-page header's live measured
    // height, published by `useInPageChromeMetrics`, so the rail self-corrects
    // instead of hard-coding a header it cannot see. Same idiom as the
    // factsheet detail rail.
    <aside
      data-testid="differential-overview-rail"
      aria-label="Diagnosis summary"
      className="hidden min-w-0 lg:block lg:sticky lg:top-[calc(var(--shell-header-h)+var(--inpage-sticky-header-height,4.75rem)+1rem)] lg:self-start"
    >
      <div className="overflow-hidden rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]">
        {doNow.length > 0 ? (
          <RailBlock title={doNowHeading(doNowCurated)} icon={Activity} tone="accent">
            {!doNowCurated ? (
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                {groupScopeNote}
              </p>
            ) : null}
            {!doNowCurated ? (
              <ul className="grid gap-2">
                {doNow.map((step) => (
                  <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
                    <span
                      className="mt-2 grid h-2 w-2 place-self-center rounded-full bg-[color:var(--clinical-accent)]"
                      aria-hidden
                    />
                    <span className="text-sm leading-6 text-[color:var(--text)]">{step}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ol className="grid gap-2">
                {doNow.map((step, index) => (
                  <li key={step} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
                    <span className="nums mt-0.5 grid h-5 w-5 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-3xs font-extrabold text-[color:var(--clinical-accent)]">
                      {index + 1}
                    </span>
                    <span className="text-sm leading-6 text-[color:var(--text)]">{step}</span>
                  </li>
                ))}
              </ol>
            )}
            {doNowCurated ? (
              <p className="mt-2 text-2xs font-semibold text-[color:var(--text-muted)]">
                {curatedProvenanceFor(curated)}
              </p>
            ) : null}
          </RailBlock>
        ) : null}

        {investigations.length > 0 ? (
          <RailBlock title="First-line tests" icon={FlaskConical}>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              {groupScopeNote}
            </p>
            <ul className="grid gap-1.5">
              {investigations.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm leading-6 text-[color:var(--text)]">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--info)]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </RailBlock>
        ) : null}

        {watchFor.length > 0 ? (
          <RailBlock title="Watch for" icon={ShieldAlert}>
            <ul className="flex flex-wrap gap-1.5">
              {watchFor.map((tag) => (
                <li key={tag}>
                  <DiagnosisTermChip
                    label={tag}
                    slug={termLinks[tag] ?? null}
                    tone="danger"
                    // compact-meta (40px), not min-h-tap: a Watch-for row mixes
                    // linked and unlinked tags of identical size, so a
                    // tap-sized chip only when linked would jump size mid-row.
                    // TOKENS.md §2's compact-meta role list ("filter chips") is
                    // the closest documented fit, and mirrors the same row in
                    // the safety snapshot (TOKENS.md requires this comment).
                    className="min-h-compact-meta px-2 text-2xs"
                  />
                </li>
              ))}
            </ul>
          </RailBlock>
        ) : null}

        {related.length > 0 ? (
          <RailBlock title="Also consider" icon={TriangleAlert}>
            <ul className="grid gap-1">
              {related.map((node) => {
                const linked = knownRelated.has(node.id);
                const body = (
                  <>
                    <span className="min-w-0 truncate text-sm font-semibold">{node.label}</span>
                    {node.likelihood === "must-not-miss" ? (
                      <span className="shrink-0 text-2xs font-extrabold uppercase text-[color:var(--danger)]">
                        Exclude
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li key={node.id}>
                    {linked ? (
                      <Link
                        href={`/differentials/diagnoses/${node.id}`}
                        className="flex min-h-tap items-center justify-between gap-2 rounded-md px-1.5 text-[color:var(--clinical-accent)] hover:bg-[color:var(--surface-subtle)]"
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className="flex min-h-tap items-center justify-between gap-2 rounded-md px-1.5 text-[color:var(--text-muted)]">
                        {body}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </RailBlock>
        ) : null}

        <div className={blockClass}>
          <p className={eyebrowClass}>Source and review</p>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-[color:var(--text-heading)]">
            <StatusMark status={sourceStatus} />
            {differentialSourceStatusLabel(sourceStatus)}
            <span className="font-medium text-[color:var(--text-muted)]">
              · {differentialValidationStatusLabel(validationStatus)}
            </span>
          </p>
          <p className="nums mt-1 text-xs text-[color:var(--text-muted)]">
            {detailContext.source.version} · exported {formatExportedDate(detailContext.source.exportedAt)}
          </p>
          <button
            type="button"
            onClick={onOpenSource}
            className="mt-1.5 inline-flex min-h-tap items-center gap-1.5 text-sm font-semibold text-[color:var(--clinical-accent)] hover:text-[color:var(--primary-strong)]"
          >
            Open source details
            <ArrowRight className="size-icon-sm shrink-0" aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}
