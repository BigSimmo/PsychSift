"use client";

import { Award, BookOpen, Lock, Plus } from "lucide-react";
import Link from "next/link";

import { focusRing } from "@/components/card-recipes";
import { CmeHint, CmeNoteLine } from "@/components/cme/cme-work-kit";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { useModeBandHeading } from "@/components/mode-band/mode-band";
import { WorkBody } from "@/components/mode-kit/work";
import { cn } from "@/components/ui-primitives";
import { cpdYearBounds, formatCalendarDateLong, formatCalendarDateShort } from "@/lib/cme/cpd-year";
import { readCpdHome } from "@/lib/cme/home-choice";
import { describeConfirmedSource } from "@/lib/cme/presets";
import {
  cmeCategoryLabels,
  type CmeCategory,
  type CmeRequirement,
  type CmeRequirementSet,
  type CmeRequirementSpec,
} from "@/lib/cme/types";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatHours(value: number): string {
  return String(round2(value));
}

function describeCategories(categories: readonly CmeCategory[]): string {
  const labels = categories.map((category) => cmeCategoryLabels[category].toLowerCase());
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const smallOrdinalWords: Record<number, string> = { 2: "two", 3: "three", 4: "four" };

function eachFloorLabel(categoryCount: number): string {
  const word = smallOrdinalWords[categoryCount] ?? String(categoryCount);
  return `…and at least this much in each of those ${word}`;
}

/**
 * The one headline "hours" figure a shape contributes toward the confirmed
 * total. Zero for the two shapes that carry no hours of their own — a count
 * of activities and a task are met or not, never partly spent.
 */
function primaryHours(spec: CmeRequirementSpec): number {
  if (spec.shape === "hours-in-category" || spec.shape === "hours-across-categories") return spec.minimumHours;
  return 0;
}

type TargetRow = { id: string; label: string; meta?: string; value: string; unit?: string };

/**
 * One requirement, as one or two display rows.
 *
 * Generic over the shape on purpose: this reads only `requirement.label` and
 * `requirement.spec`, never a hardcoded id or a wording tied to one specific
 * requirement. Whatever the owner has actually confirmed — for the national
 * baseline or a college's own extras — renders the same way, which is what
 * lets one function serve both sections below.
 */
function targetRows(requirement: CmeRequirement): TargetRow[] {
  const spec = requirement.spec;
  switch (spec.shape) {
    case "credited-hours":
      return [
        {
          id: requirement.id,
          label: requirement.label,
          meta: "Credited within reviewing-performance hours",
          value: formatHours(spec.minimumHours),
          unit: "h",
        },
      ];
    case "hours-in-category":
      return [
        {
          id: requirement.id,
          label: requirement.label,
          meta: "At least",
          value: formatHours(spec.minimumHours),
          unit: "h",
        },
      ];
    case "hours-across-categories": {
      const rows: TargetRow[] = [
        {
          id: requirement.id,
          label: requirement.label,
          meta: `Combined (${describeCategories(spec.categories)}), at least`,
          value: formatHours(spec.minimumHours),
          unit: "h",
        },
      ];
      // Zero means the demo or owner data expresses no per-category floor on
      // this requirement — nothing to show a second row for.
      if (spec.minimumEachHours > 0) {
        rows.push({
          id: `${requirement.id}-each`,
          label: eachFloorLabel(spec.categories.length),
          value: formatHours(spec.minimumEachHours),
          unit: "h",
        });
      }
      return rows;
    }
    case "activity-count":
      return [
        {
          id: requirement.id,
          label: requirement.label,
          meta: spec.buckets.length > 0 ? spec.buckets.join(" · ") : undefined,
          value: spec.minimumPerBucket === 1 ? "One activity each" : `${spec.minimumPerBucket} activities each`,
        },
      ];
    case "task":
      return [{ id: requirement.id, label: requirement.label, value: "Every year" }];
  }
}

function TargetRowView({ row }: { row: TargetRow }) {
  return (
    <div id={`cme-requirement-${row.id}`} className={cn(inPageAnchor, "cpd-kv cpd-kv--wrap")}>
      <dt className="min-w-0">
        <span className="block">{row.label}</span>
        {row.meta ? <span className="work-row__sub block">{row.meta}</span> : null}
      </dt>
      <dd className="shrink-0">
        {row.unit ? (
          <>
            <span className="nums font-normal">{row.value}</span> {row.unit}
          </>
        ) : (
          row.value
        )}
      </dd>
    </div>
  );
}

/**
 * The Targets screen (mock-up cpd_targets). The safety property this whole
 * mode exists to protect lives here. Every target on this page comes from
 * `set`, which the owner confirmed on a stated date against a stated document;
 * nothing here is a default this code invented, and the provenance block below
 * is not optional decoration.
 */
export function CmeProgrammePage({
  set,
  title = "Targets",
  onReconfirm,
  onAddCollegeRequirement,
}: {
  set: CmeRequirementSet;
  title?: string;
  /** Wired by a future task. Phase 1 has no re-confirmation flow to hand this to yet. */
  onReconfirm?: () => void;
  /** Wired by a future task. Phase 1 has no college-requirement editor yet. */
  onAddCollegeRequirement?: () => void;
}) {
  const nationalRequirements = set.requirements.filter((requirement) => requirement.source === "national");
  const collegeRequirements = set.requirements.filter((requirement) => requirement.source === "college");
  const nationalRows = nationalRequirements.flatMap(targetRows);
  const collegeRows = collegeRequirements.flatMap(targetRows);

  // The remainder of the confirmed total not already spoken for by a named
  // category minimum. This is arithmetic on the owner's own two confirmed
  // numbers — the total, and each requirement's own minimum — never a figure
  // typed in on its own, so it carries the same provenance as the numbers it
  // is built from. College extras "sit on top of the baseline" (the note
  // below says so), so only national requirements are netted against it.
  const namedNationalHours = nationalRequirements.reduce((sum, requirement) => sum + primaryHours(requirement.spec), 0);
  const selfAllocatedHours = round2(set.totalHours - namedNationalHours);

  const yearBounds = cpdYearBounds(set.year);
  const home = readCpdHome(set.confirmedSource);
  const homeName =
    home.kind === "ranzcp"
      ? "RANZCP"
      : home.kind === "national"
        ? "National baseline"
        : home.name || "Your own targets";
  const confirmedShort = formatCalendarDateShort(set.confirmedOn);
  const reconfirmClass = cn(focusRing, "work-button min-h-12 w-full");

  useModeBandHeading({ eyebrow: `${set.year} · confirmed ${confirmedShort}`, title: "Targets" });

  return (
    <main data-testid="cme-programme-page" data-mode-identity="cme" className="w-full">
      <WorkBody>
        <h1 className="sr-only">{title}</h1>

        <div className="work-card work-row" data-testid="cme-programme-home">
          <span className="work-ic" aria-hidden="true">
            <Award aria-hidden="true" strokeWidth={1.8} />
          </span>
          <span className="work-row__text">
            <span className="work-row__title">{homeName}</span>
            <span className="work-row__sub">Your CPD home for {set.year}</span>
          </span>
          <span className="work-tag">CPD home</span>
        </div>

        <section
          id="cme-national-baseline"
          data-testid="cme-national-baseline"
          aria-labelledby="cme-national-baseline-heading"
          className={cn(inPageAnchor, "grid gap-1.5")}
        >
          <div className="work-label">
            <h2 id="cme-national-baseline-heading" className="m-0 text-inherit font-inherit">
              Medical Board standard
            </h2>
            <span>As you confirmed it</span>
          </div>
          <dl className="work-card m-0">
            <TargetRowView
              row={{ id: "total", label: "Total, any category", value: formatHours(set.totalHours), unit: "h" }}
            />
            {nationalRows.map((row) => (
              <TargetRowView key={row.id} row={row} />
            ))}
            {selfAllocatedHours > 0.004 ? (
              <TargetRowView
                row={{
                  id: "self-allocated",
                  label: "Yours to allocate",
                  meta: "Any category",
                  value: formatHours(selfAllocatedHours),
                  unit: "h",
                }}
              />
            ) : null}
          </dl>
        </section>

        <section
          id="cme-college-extras"
          data-testid="cme-college-extras"
          aria-labelledby="cme-college-extras-heading"
          className={cn(inPageAnchor, "grid gap-1.5")}
        >
          <div className="work-label">
            <h2 id="cme-college-extras-heading" className="m-0 text-inherit font-inherit">
              College extra
            </h2>
            {onAddCollegeRequirement ? (
              <button type="button" onClick={onAddCollegeRequirement} className="work-label__link min-h-tap">
                <Plus className="size-icon-sm shrink-0" aria-hidden="true" />
                Add
              </button>
            ) : (
              <Link
                href={`/cme/setup?year=${set.year}&edit=1#cme-setup-requirements-heading`}
                className="work-label__link min-h-tap"
              >
                <Plus className="size-icon-sm shrink-0" aria-hidden="true" />
                Add
              </Link>
            )}
          </div>
          {collegeRows.length > 0 ? (
            <dl className="work-card m-0">
              {collegeRows.map((row) => (
                <TargetRowView key={row.id} row={row} />
              ))}
            </dl>
          ) : (
            <div className="work-card work-card--pad">
              <p className="work-row__sub m-0">Nothing added yet. The national standard above applies on its own.</p>
            </div>
          )}
          <CmeHint>
            {collegeRequirements.some((requirement) => requirement.spec.shape === "credited-hours")
              ? "Peer review is counted within reviewing hours, never added on top. Extras sit on top of the baseline, never in place of it."
              : "Extras sit on top of the baseline, never in place of it."}
          </CmeHint>
        </section>

        <section
          id="cme-provenance"
          data-testid="cme-provenance"
          aria-labelledby="cme-provenance-heading"
          className={cn(inPageAnchor, "grid gap-1.5")}
        >
          <h2 id="cme-provenance-heading" className="work-label m-0">
            Source you checked
          </h2>
          <div className="work-card work-row">
            <span className="work-ic" aria-hidden="true">
              <BookOpen aria-hidden="true" strokeWidth={1.8} />
            </span>
            <span className="work-row__text">
              <span className="work-row__title">These are your numbers, not ours</span>
              <span className="work-row__sub break-words">
                Confirmed by you on {formatCalendarDateLong(set.confirmedOn)}, against{" "}
                {describeConfirmedSource(set.confirmedSource)}.
              </span>
            </span>
          </div>
          <div data-testid="cme-no-lookup">
            <CmeNoteLine icon={Lock}>
              Your numbers. The app never looks up a requirement on its own, and it never changes one without you.
            </CmeNoteLine>
          </div>
          {onReconfirm ? (
            <button type="button" onClick={onReconfirm} className={reconfirmClass} data-variant="secondary">
              Re-confirm targets
            </button>
          ) : (
            <Link href={`/cme/setup?year=${set.year}&edit=1`} className={reconfirmClass} data-variant="secondary">
              Re-confirm targets
            </Link>
          )}
        </section>

        <section id="cme-year-shape" data-testid="cme-year-shape" className={cn(inPageAnchor, "grid gap-1")}>
          <CmeHint>
            Your {set.year} CPD year, as this app tracks it, runs from {formatCalendarDateLong(yearBounds.start)} to{" "}
            {formatCalendarDateLong(yearBounds.end)}.
          </CmeHint>
          <CmeHint>
            Changing your status next year does not rewrite this one. Each year keeps the requirements that applied to
            it.
          </CmeHint>
        </section>
      </WorkBody>
    </main>
  );
}
