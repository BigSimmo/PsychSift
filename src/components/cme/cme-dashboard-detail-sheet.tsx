"use client";

import { BookOpen, Users } from "lucide-react";
import type { ReactNode } from "react";

import { formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { CmeFlatList, CmeFlatRow, CmeGroup } from "@/components/cme/cme-flat-list";
import { CmeHint, CmeKvCard, CmeMiniMeter } from "@/components/cme/cme-work-kit";
import { WorkButton } from "@/components/mode-kit/work";
import { Sheet } from "@/components/ui/sheet";
import { isHoursRequirementShape } from "@/lib/cme/requirement-gaps";
import type { CmeRoutineGapScenario } from "@/lib/cme/pace";
import { describeConfirmedSource } from "@/lib/cme/presets";
import { formatRoutineDueDate } from "@/lib/cme/routines";
import {
  cmeCategories,
  cmeCategoryLabels,
  type CmeEntry,
  type CmeRequirement,
  type CmeRequirementSet,
  type CmeRequirementStatus,
} from "@/lib/cme/types";

/** What Today's detail sheet is showing: the year's hours, the gap to the total, or one requirement by id. */
export type CmeTodayDetail = "hours" | "gap" | string | null;

function contribution(entry: CmeEntry, requirement?: CmeRequirement): number {
  if (!requirement) return entry.allocations.reduce((sum, item) => sum + item.hours, 0);
  const { spec } = requirement;
  if (spec.shape === "hours-in-category")
    return entry.allocations
      .filter((item) => item.category === spec.category)
      .reduce((sum, item) => sum + item.hours, 0);
  if (spec.shape === "hours-across-categories")
    return entry.allocations
      .filter((item) => spec.categories.includes(item.category))
      .reduce((sum, item) => sum + item.hours, 0);
  if (spec.shape === "credited-hours")
    return Math.min(
      entry.formalPeerReviewHours ?? 0,
      entry.allocations.filter((item) => item.category === "reviewing").reduce((sum, item) => sum + item.hours, 0),
    );
  return 0;
}

const shortWeekday = new Intl.DateTimeFormat("en-AU", { weekday: "short", timeZone: "UTC" });

/** "Thu 31 Dec" for the year's last day. */
function yearEndLabel(year: number): string {
  return `${shortWeekday.format(new Date(Date.UTC(year, 11, 31)))} 31 Dec`;
}

function filteredLogHref(year: number, requirement?: CmeRequirement): string {
  const category = requirement?.spec.shape === "hours-in-category" ? requirement.spec.category : null;
  return `/cme/log?year=${year}${category ? `&category=${category}` : ""}`;
}

/**
 * Today's one detail sheet. Every figure on Today opens here rather than
 * leaving the page: the hero's hours (what makes them up, by category), an
 * hours requirement from "What's left" (which activities count toward it, and
 * Log filtered to them), and the catch-up card's routine scenarios. Each says
 * where its target came from, because this app does not certify it.
 */
export function CmeTodayDetailSheet({
  detail,
  onClose,
  set,
  statuses,
  yearEntries,
  totalHours,
  totalGap,
  gapScenarios,
  routineEstimateHours = 0,
  remainingAfterRoutines = null,
  stillToFindWeekly = null,
  weeks = null,
}: {
  detail: CmeTodayDetail;
  onClose: () => void;
  set: CmeRequirementSet;
  statuses: readonly CmeRequirementStatus[];
  /** This year's unarchived activities. */
  yearEntries: readonly CmeEntry[];
  totalHours: number;
  totalGap: number;
  gapScenarios: readonly CmeRoutineGapScenario[];
  /** What the owner's routines would likely add by 31 December (the catch-up plan). */
  routineEstimateHours?: number;
  /** Hours still to find after routines, or null when there is no plan. */
  remainingAfterRoutines?: number | null;
  /** That figure spread over the weeks left, or null when a weekly figure means nothing. */
  stillToFindWeekly?: number | null;
  /** The year in weeks chart, moved here from the hero. */
  weeks?: ReactNode;
}) {
  const detailRequirement =
    detail && detail !== "hours" && detail !== "gap"
      ? set.requirements.find((requirement) => requirement.id === detail)
      : undefined;
  const detailStatus = detailRequirement
    ? statuses.find((status) => status.requirementId === detailRequirement.id)
    : undefined;
  const detailedEntries = yearEntries.filter((entry) => contribution(entry, detailRequirement) > 0);
  const detailHours = detailRequirement ? (detailStatus?.progress?.value ?? 0) : totalHours;

  return (
    <Sheet
      open={detail !== null}
      onClose={onClose}
      title={detail === "gap" ? "Close the gap" : (detailRequirement?.label ?? "CPD hours")}
      description={
        detail === "gap"
          ? `${formatCmeHours(totalGap)} h to go by ${yearEndLabel(set.year)}`
          : "What makes up this figure"
      }
      testId="cme-today-detail-sheet"
    >
      {detail === "gap" ? (
        <div className="grid gap-4 text-sm text-[color:var(--text)]">
          <CmeKvCard
            label="The gap"
            rows={[
              { label: "Logged", value: `${formatCmeHours(totalHours)} h` },
              ...(routineEstimateHours > 0
                ? [{ label: "Routines likely add", value: `${formatCmeHours(routineEstimateHours)} h` }]
                : []),
              {
                label: "Still to find",
                value: `${formatCmeHours(remainingAfterRoutines ?? totalGap)} h${
                  stillToFindWeekly !== null ? ` · ${stillToFindWeekly.toFixed(1)} h a week` : ""
                }`,
              },
            ]}
          />
          <CmeHint>
            {formatCmeHours(totalGap)} h remain to your {formatCmeHours(set.totalHours)} h target. This is based on your
            saved entries and the target you confirmed on {formatRoutineDueDate(set.confirmedOn)}.
          </CmeHint>
          {statuses.some((status) => {
            const requirement = set.requirements.find((item) => item.id === status.requirementId);
            return requirement && isHoursRequirementShape(requirement.spec.shape) && status.progress;
          }) ? (
            <CmeGroup label="Against the minimums">
              <CmeFlatList>
                {set.requirements
                  .filter((requirement) => isHoursRequirementShape(requirement.spec.shape))
                  .map((requirement) => {
                    const status = statuses.find((item) => item.requirementId === requirement.id);
                    if (!status?.progress) return null;
                    const { value, target } = status.progress;
                    return (
                      <CmeFlatRow
                        key={requirement.id}
                        title={requirement.label}
                        subtitle={`${formatCmeHours(value)} of ${formatCmeHours(target)} h · ${status.met ? "reached" : status.summary}`}
                        end={<CmeMiniMeter fraction={target > 0 ? value / target : 0} />}
                      />
                    );
                  })}
              </CmeFlatList>
            </CmeGroup>
          ) : null}
          <CmeGroup label="Routines to 31 Dec">
            {gapScenarios.length ? (
              <CmeFlatList testId="cme-gap-scenarios">
                {gapScenarios.map((scenario) => (
                  <CmeFlatRow
                    key={scenario.routineId}
                    lead={
                      /peer|group|supervis|balint|meeting/i.test(scenario.title) ? (
                        <Users aria-hidden="true" strokeWidth={2} />
                      ) : (
                        <BookOpen aria-hidden="true" strokeWidth={2} />
                      )
                    }
                    title={scenario.title}
                    subtitle={`${scenario.occurrences} × ${formatCmeHours(scenario.hoursPerOccurrence)} h = ${formatCmeHours(scenario.projectedHours)} h by 31 Dec${scenario.closesGap ? "" : ", short of the gap on its own"}`}
                    end={<b className="nums whitespace-nowrap">{`${formatCmeHours(scenario.projectedHours)} h`}</b>}
                  />
                ))}
              </CmeFlatList>
            ) : (
              <CmeHint>No active routine with usual hours is saved. You can still log individual activities.</CmeHint>
            )}
          </CmeGroup>
          {weeks ? <CmeGroup label="Each week">{weeks}</CmeGroup> : null}
          <CmeHint>
            These are examples using your routine templates. Only activities you actually do and save count as CPD. A
            routine never logs itself. Category and other requirements may still need attention.
          </CmeHint>
          <div className="cpd-two">
            <WorkButton variant="secondary" href={`/cme/routines?year=${set.year}`}>
              Review routines
            </WorkButton>
            <WorkButton variant="primary" href={`/cme/log?year=${set.year}`}>
              View Log
            </WorkButton>
          </div>
        </div>
      ) : (
        <div className="space-y-4 text-sm text-[color:var(--text)]">
          <p data-testid="cme-today-detail-total">
            <strong>{formatCmeHours(detailHours)} h</strong> from {detailedEntries.length}{" "}
            {detailedEntries.length === 1 ? "saved activity" : "saved activities"} in {set.year}.
          </p>
          {detailRequirement ? (
            <p>
              This {detailRequirement.source === "national" ? "national" : "college"} target was recorded by you on{" "}
              {formatRoutineDueDate(set.confirmedOn)} from {describeConfirmedSource(set.confirmedSource)}. It is not
              independently certified by this app.
            </p>
          ) : (
            <>
              <p>
                Target recorded by you on {formatRoutineDueDate(set.confirmedOn)} from{" "}
                {describeConfirmedSource(set.confirmedSource)}. This app does not independently certify it.
              </p>
              <ul className="space-y-1" aria-label="Hours by category">
                {cmeCategories.map((category) => {
                  const hours = yearEntries.reduce(
                    (sum, entry) =>
                      sum +
                      entry.allocations
                        .filter((item) => item.category === category)
                        .reduce((part, item) => part + item.hours, 0),
                    0,
                  );
                  return (
                    <li key={category} className="flex justify-between gap-3">
                      <span>{cmeCategoryLabels[category]}</span>
                      <span>{formatCmeHours(hours)} h</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <WorkButton variant="secondary" size="wide" href={filteredLogHref(set.year, detailRequirement)}>
            {detailRequirement?.spec.shape === "hours-in-category"
              ? `View ${cmeCategoryLabels[detailRequirement.spec.category].toLowerCase()} in Log`
              : "View this year's Log"}
          </WorkButton>
        </div>
      )}
    </Sheet>
  );
}
