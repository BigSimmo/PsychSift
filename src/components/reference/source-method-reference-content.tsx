import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, Scale, ShieldAlert } from "lucide-react";

import { ClinicalBadge } from "@/components/clinical-dashboard/clinical-badge";
import { cn, eyebrowText, raisedCard } from "@/components/ui-primitives";
import type { SemanticTone } from "@/lib/semantic-tone";
import {
  SOURCE_CATALOGUE_STATUS_GROUPS,
  SOURCE_METHOD_BOUNDARIES,
  SOURCE_METHOD_DISCLAIMER,
  SOURCE_METHOD_ROUTE,
  SOURCE_QUALITY_BAND_SCALE,
  SOURCE_RATING_DIMENSIONS,
  SOURCE_RATING_TOTAL_POINTS,
  sourceBandBrowseHref,
} from "@/lib/sources/rating-method";

export type SourceMethodReferenceContentProps = {
  variant: "page" | "guide";
  /** Guide variant only: leaves the dialog for the full method page. */
  onOpenFullPage?: () => void;
};

/**
 * Solid tone fills for the score scale. Only the scale uses these — every other
 * tone on this page arrives through `ClinicalBadge`, so a band cannot pick up a
 * colour here that the catalogue does not give it.
 */
const BAND_SEGMENT_FILL: Record<SemanticTone, string> = {
  success: "bg-[color:var(--success)]",
  info: "bg-[color:var(--info)]",
  neutral: "bg-[color:var(--text-muted)]",
  warning: "bg-[color:var(--warning)]",
  danger: "bg-[color:var(--danger)]",
  clinical: "bg-[color:var(--clinical-accent)]",
};

/**
 * The score-derived bands, weakest first, each with the upper edge of its window
 * on the 0–100 axis. Derived rather than written down: the segment widths and the
 * tick marks then move with the thresholds the scorer actually applies.
 */
function scoreScaleSegments() {
  const scored = SOURCE_QUALITY_BAND_SCALE.filter(
    (definition): definition is (typeof SOURCE_QUALITY_BAND_SCALE)[number] & { minScore: number } =>
      definition.minScore !== null,
  ).toSorted((left, right) => left.minScore - right.minScore);

  return scored.map((definition, index) => ({
    ...definition,
    upperEdge: scored[index + 1]?.minScore ?? SOURCE_RATING_TOTAL_POINTS,
  }));
}

function SectionCard({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section className={cn(raisedCard, "p-4 sm:p-5")} aria-labelledby={id}>
      <h3 id={id} className="text-base font-semibold text-[color:var(--text-heading)]">
        {title}
      </h3>
      <p className="mt-1 max-w-[68ch] text-xs leading-5 text-[color:var(--text-muted)]">{intro}</p>
      {children}
    </section>
  );
}

/**
 * The weighting, drawn to scale. The bar is decoration — the points sit in the
 * text beside it — so nothing here depends on reading a width or a colour.
 */
function RatingDimensions() {
  return (
    <SectionCard
      id="method-weights"
      title="Rating dimensions"
      intro={`Every source is scored out of ${SOURCE_RATING_TOTAL_POINTS} across six dimensions, shown here in weight order. How the source is assured and who published it carry most of the outcome.`}
    >
      <dl className="mt-4 divide-y divide-[color:var(--border)]">
        {SOURCE_RATING_DIMENSIONS.map((dimension) => (
          // One wrapper, holding only the dt and its dds (#Q80S8B); the grid puts
          // the weight bar in the second column beside the term and description.
          <div key={dimension.key} className="grid py-3 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] sm:gap-x-6">
            <dt className="min-w-0 text-sm font-semibold text-[color:var(--text-heading)] sm:col-start-1 sm:row-start-1">
              {dimension.label}
            </dt>
            <dd className="mt-0.5 min-w-0 text-xs leading-5 text-[color:var(--text-muted)] sm:col-start-1 sm:row-start-2">
              {dimension.description}
            </dd>
            <dd className="mt-1.5 flex min-w-0 items-center gap-3 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0 sm:self-start sm:pt-1">
              <div
                aria-hidden="true"
                className="h-2 w-full min-w-0 overflow-hidden rounded-full bg-[color:var(--surface-inset)] shadow-[var(--shadow-inset)]"
              >
                <div
                  className="h-full origin-left rounded-full bg-[color:var(--clinical-accent)]"
                  style={{ transform: `scaleX(${dimension.points / SOURCE_RATING_TOTAL_POINTS})` }}
                />
              </div>
              <span className="nums w-20 shrink-0 whitespace-nowrap text-right text-xs font-semibold text-[color:var(--text-heading)]">
                {dimension.points} points
              </span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-[color:var(--border)] pt-3 text-xs font-semibold text-[color:var(--text-heading)]">
        <span className="nums">{SOURCE_RATING_TOTAL_POINTS} points</span> at full marks on every dimension.
      </p>
    </SectionCard>
  );
}

/**
 * The bands, with the cut points drawn where the scorer actually puts them.
 *
 * The browse link stays a control of its own rather than a link wrapped around
 * the definition: a reader who has just learned what "D · Review required" means
 * is usually asking which sources are in it, and the definition should still read
 * as prose while the route out of it is unmistakably a route.
 */
function QualityBands() {
  const segments = scoreScaleSegments();

  return (
    <SectionCard
      id="method-bands"
      title="Quality bands"
      intro="A clean score falls into one of three bands. The two below are not reached by score at all — they are applied first, on identity, lifecycle and governance grounds."
    >
      {/*
        The scale is drawn from the thresholds, not from hand-set widths. One grid
        template — set once as a custom property and shared by the track and its
        cut-point labels — sizes both rows, so moving a threshold moves the
        picture and the numbers together.
      */}
      <div
        aria-hidden="true"
        className="mt-4"
        style={
          {
            "--band-scale-columns": [
              `${segments[0]?.minScore ?? 0}fr`,
              ...segments.map((segment) => `${segment.upperEdge - segment.minScore}fr`),
            ].join(" "),
          } as CSSProperties
        }
      >
        <div className="grid h-2 w-full grid-cols-[var(--band-scale-columns)] overflow-hidden rounded-full bg-[color:var(--surface-inset)] shadow-[var(--shadow-inset)]">
          <span />
          {segments.map((segment) => (
            <span key={segment.band} className={BAND_SEGMENT_FILL[segment.tone]} />
          ))}
        </div>
        <div className="nums mt-1.5 grid grid-cols-[var(--band-scale-columns)] text-2xs font-medium text-[color:var(--text-muted)]">
          <span>0</span>
          {segments.map((segment) => (
            <span key={segment.band}>{segment.minScore}</span>
          ))}
        </div>
      </div>

      <ul className="mt-4 divide-y divide-[color:var(--border)]">
        {SOURCE_QUALITY_BAND_SCALE.map((definition) => (
          <li
            key={definition.band}
            className="grid gap-1.5 py-3 sm:grid-cols-[13rem_minmax(0,1fr)_auto] sm:items-baseline sm:gap-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <ClinicalBadge tone={definition.tone} label={definition.label} />
              {definition.minScore === null ? null : (
                <span className="nums text-xs font-medium text-[color:var(--text-muted)]">
                  {definition.minScore}–{definition.maxScore}
                </span>
              )}
            </div>
            <p className="min-w-0 text-xs leading-5 text-[color:var(--text-muted)]">{definition.description}</p>
            <Link
              href={sourceBandBrowseHref(definition.band)}
              className="inline-flex min-h-tap items-center gap-1 justify-self-start whitespace-nowrap rounded-md text-xs font-semibold text-[color:var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] sm:justify-self-end"
            >
              Browse {definition.label}
              <ChevronRight aria-hidden="true" className="size-icon-sm" />
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * What the score bounds, then what it is not. The disclaimer is deliberately not
 * the fourth card of four — it is the clinical boundary of the whole page.
 */
function BoundariesAndLimits() {
  return (
    <SectionCard
      id="method-limits"
      title="Boundaries and missing data"
      intro="Where the score stops. Absent metadata is recorded as unknown and demoted, never inferred and never rounded up."
    >
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {SOURCE_METHOD_BOUNDARIES.map((boundary) => (
          <div
            key={boundary.title}
            className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-subtle)] p-3"
          >
            <p className="text-xs font-semibold text-[color:var(--text-heading)]">{boundary.title}</p>
            <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">{boundary.statement}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-start gap-2.5 rounded-md border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-3">
        <ShieldAlert aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-[color:var(--warning)]" />
        <p className="min-w-0 text-xs leading-5 text-[color:var(--text)]">
          <span className="font-semibold">What this rating is not. </span>
          {SOURCE_METHOD_DISCLAIMER}
        </p>
      </div>
    </SectionCard>
  );
}

/**
 * The status vocabulary, badged as the catalogue badges it, so the reference and
 * the rows it explains cannot read as two different systems. The three status
 * axes are independent: official does not imply current, and current does not
 * imply approved.
 */
function StatusDefinitions() {
  return (
    <SectionCard
      id="method-status-definitions"
      title="Catalogue status definitions"
      intro="Four independent axes. A source can be current and still unverified, or approved and no longer active."
    >
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* Hyphenated: a spaced id ("Content mode") splits in aria-labelledby into references to nothing. */}
        {SOURCE_CATALOGUE_STATUS_GROUPS.map((group) => (
          <section
            key={group.heading}
            aria-labelledby={`method-status-${group.heading.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <h4
              id={`method-status-${group.heading.toLowerCase().replace(/\s+/g, "-")}`}
              className="text-sm font-semibold text-[color:var(--text-heading)]"
            >
              {group.heading}
            </h4>
            <p className="mt-0.5 text-xs leading-5 text-[color:var(--text-muted)]">{group.summary}</p>
            <dl className="mt-2 divide-y divide-[color:var(--border)]">
              {group.statuses.map((status) => (
                // Stacked on phones: a fixed badge column at 320px left the
                // definition about four characters wide.
                <div key={status.label} className="grid gap-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="justify-self-start sm:pt-0.5">
                    <ClinicalBadge tone={status.tone} label={status.label} />
                  </dt>
                  <dd className="min-w-0 text-xs leading-5 text-[color:var(--text-muted)]">{status.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * The published rating method, rendered identically on `/sources/method` and
 * inside the Guide Centre. One component so the governance page a clinician
 * reaches from Sources and the one they reach from the guide can never disagree.
 */
export function SourceMethodReferenceContent({ variant, onOpenFullPage }: SourceMethodReferenceContentProps) {
  const isGuide = variant === "guide";

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className={cn(eyebrowText, "flex items-center gap-2 text-[color:var(--clinical-accent)]")}>
          <Scale aria-hidden="true" className="size-icon-md" /> Source catalogue method
        </p>
        <h2
          data-guide-page-heading={isGuide ? true : undefined}
          tabIndex={isGuide ? -1 : undefined}
          className="text-2xl font-semibold tracking-tight text-[color:var(--text-heading)] outline-none sm:text-3xl"
        >
          How sources are rated
        </h2>
        <p className="max-w-[68ch] text-sm leading-6 text-[color:var(--text-muted)]">
          Every source in the catalogue is scored out of {SOURCE_RATING_TOTAL_POINTS} on how well it can be trusted as a
          reference, then placed in a band. The rating describes the source as a document — its publisher, version,
          currency and traceability. It says nothing about whether the guidance inside it fits the patient in front of
          you.
        </p>
      </header>

      <RatingDimensions />
      <QualityBands />
      <BoundariesAndLimits />
      <StatusDefinitions />

      {isGuide ? (
        <div className="flex justify-center pt-1">
          {onOpenFullPage ? (
            <button
              type="button"
              onClick={onOpenFullPage}
              className="inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Open the full method page
              <ChevronRight aria-hidden="true" className="size-icon-sm" />
            </button>
          ) : (
            <Link
              href={SOURCE_METHOD_ROUTE}
              className="inline-flex min-h-tap items-center gap-1 rounded-md text-sm font-semibold text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Open the full method page
              <ChevronRight aria-hidden="true" className="size-icon-sm" />
            </Link>
          )}
        </div>
      ) : null}
    </div>
  );
}
