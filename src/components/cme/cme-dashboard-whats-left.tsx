"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { focusRing } from "@/components/card-recipes";
import { CmeFlatList, CmeGroup, CmeRowMark, CmeTextLink } from "@/components/cme/cme-flat-list";
import { modeInsetHairline, modePressable, modeRowHeight } from "@/components/mode-kit/recipes";
import { cn } from "@/components/ui-primitives";
import { formatCmeHours } from "@/components/cme/cme-dashboard-next-step";
import { isHoursRequirementShape, rankRequirementsByGap } from "@/lib/cme/requirement-gaps";
import type { CmeRequirementSet, CmeRequirementStatus } from "@/lib/cme/types";
import type { CmeYearCheck, CmeYearCheckRow } from "@/lib/cme/year-check";

/**
 * THE YEAR PAGE'S "WHAT'S LEFT": the year check's open items, one per row.
 *
 * Every row comes from the live year check (`buildCmeYearCheck`), so this
 * list and the Year check page can never disagree: the hours total first,
 * then each confirmed target still short (biggest gap first, through
 * `rankRequirementsByGap`), then the three record checks an auditor asks for
 * (evidence, reflection, copied to the CPD home). Each row has an open circle
 * and its own status words; shortfall reads through position and wording,
 * never red, amber or green. Everything already done folds into one
 * "N done · …" row that opens to list them.
 *
 * A row opens what is behind it: an hours figure opens the Year page's detail
 * sheet (which activities make it up); a task opens its place in Set up; a
 * practice-domain count opens the Log form; a record check opens the Log
 * filtered to the activities it names.
 *
 * When the page's one next step is a row here (`nextStepRowId`), that row
 * carries the `cme-next-action` test id and the page does not repeat it.
 */

type WhatsLeftRow = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly ready: boolean;
  /** An hours figure: opens the detail sheet for this id ("hours" or a requirement id). */
  readonly detail?: string;
  readonly href?: string;
};

function requirementId(row: CmeYearCheckRow): string | null {
  return row.id.startsWith("requirement-") ? row.id.slice("requirement-".length) : null;
}

/** "Educational activities, development plan": later labels drop a leading capital unless it starts an acronym. */
function joinLabels(labels: readonly string[]): string {
  return labels
    .map((label, index) =>
      index > 0 && label.length > 1 && label[1] === label[1].toLowerCase()
        ? label[0].toLowerCase() + label.slice(1)
        : label,
    )
    .join(", ");
}

export function buildWhatsLeftRows({
  set,
  statuses,
  yearCheck,
  totalHours,
}: {
  set: CmeRequirementSet;
  statuses: readonly CmeRequirementStatus[];
  yearCheck: CmeYearCheck;
  /** `evaluateYear`'s total: the same `totalAllocatedHours` the year check's total row counts. */
  totalHours: number;
}): WhatsLeftRow[] {
  const byId = new Map(yearCheck.rows.map((row) => [row.id, row]));
  const rows: WhatsLeftRow[] = [];

  const total = byId.get("total");
  if (total) {
    // The same figure the year check counts (`totalAllocatedHours`, archived activities left out).
    const shortBy = Math.max(0, Math.round((set.totalHours - totalHours) * 100) / 100);
    rows.push({
      id: "total",
      title: "Hours in total",
      subtitle: total.ready ? total.summary : `${formatCmeHours(shortBy)} h to go`,
      ready: total.ready,
      detail: "hours",
    });
  }

  // Targets in gap order: hours by hours to go, then empty practice domains, then tasks not started.
  for (const status of rankRequirementsByGap(set, statuses)) {
    const row = byId.get(`requirement-${status.requirementId}`);
    const requirement = set.requirements.find((item) => item.id === status.requirementId);
    if (!row || !requirement) continue;
    const shape = requirement.spec.shape;
    rows.push({
      id: row.id,
      title: requirement.label,
      subtitle: row.summary,
      ready: row.ready,
      ...(isHoursRequirementShape(shape)
        ? { detail: requirement.id }
        : {
            href:
              shape === "task"
                ? `/cme/setup?year=${set.year}#cme-requirement-${encodeURIComponent(requirement.id)}`
                : `/cme/new?year=${set.year}`,
          }),
    });
  }
  // Any target the ranking did not cover still appears once.
  for (const row of yearCheck.rows) {
    const id = requirementId(row);
    if (id && !rows.some((item) => item.id === row.id)) {
      rows.push({ id: row.id, title: row.label, subtitle: row.summary, ready: row.ready, href: row.action?.href });
    }
  }

  for (const row of yearCheck.rows.filter((item) => item.group === "records")) {
    rows.push({
      id: row.id,
      title: row.label,
      subtitle: row.summary,
      ready: row.ready,
      // A row the app could not count opens the year check, which explains why.
      href: row.notChecked ? `/cme/check?year=${set.year}` : (row.action?.href ?? `/cme/log?year=${set.year}`),
    });
  }
  return rows;
}

function RowBody({ row }: { row: WhatsLeftRow }) {
  return (
    <>
      <CmeRowMark state={row.ready ? "done" : "open"} />
      <span className="grid min-w-0 flex-1 gap-px py-2">
        <span className="break-words text-sm font-medium leading-5 text-[color:var(--text-heading)]">{row.title}</span>
        <span className="nums line-clamp-2 break-words text-sm-minus leading-4.5 text-[color:var(--text-muted)]">
          {row.subtitle}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0 text-[color:var(--text-muted)]" />
    </>
  );
}

const ROW_CONTROL = cn(
  modeRowHeight.double,
  modePressable,
  focusRing,
  "flex w-full min-w-0 items-center gap-3 text-left no-underline",
);

function Row({
  row,
  isNext,
  onOpenDetail,
}: {
  row: WhatsLeftRow;
  isNext: boolean;
  onOpenDetail: (detail: string) => void;
}) {
  const detail = row.detail;
  return (
    <li
      data-met={row.ready ? "true" : "false"}
      data-testid={isNext ? "cme-next-action" : undefined}
      className={cn(modeInsetHairline, "flex min-w-0 items-center before:left-0")}
    >
      {detail ? (
        <button type="button" className={ROW_CONTROL} onClick={() => onOpenDetail(detail)}>
          <RowBody row={row} />
        </button>
      ) : (
        <Link href={row.href ?? "/cme/check"} className={ROW_CONTROL}>
          <RowBody row={row} />
        </Link>
      )}
    </li>
  );
}

export function CmeWhatsLeft({
  set,
  statuses,
  yearCheck,
  totalHours,
  nextStepRowId,
  onOpenDetail,
}: {
  set: CmeRequirementSet;
  statuses: readonly CmeRequirementStatus[];
  yearCheck: CmeYearCheck;
  totalHours: number;
  /** The row that IS the page's next step ("total" or "requirement-<id>"), or null. */
  nextStepRowId: string | null;
  onOpenDetail: (detail: string) => void;
}) {
  const rows = buildWhatsLeftRows({ set, statuses, yearCheck, totalHours });
  if (rows.length === 0) return null;
  const left = rows.filter((row) => !row.ready);
  const done = rows.filter((row) => row.ready);
  const label: ReactNode = left.length > 0 ? `What's left · ${left.length}` : "What's left";

  return (
    <CmeGroup
      label={label}
      testId="cme-requirements"
      end={
        <CmeTextLink href={`/cme/check?year=${set.year}`} testId="cme-year-check-link">
          Year check
        </CmeTextLink>
      }
    >
      <CmeFlatList label="What's left">
        {left.length === 0 ? (
          <li className="flex min-h-12 items-center text-sm-minus text-[color:var(--text-muted)]">
            Everything in the year check is done.
          </li>
        ) : null}
        {left.map((row) => (
          <Row key={row.id} row={row} isNext={row.id === nextStepRowId} onOpenDetail={onOpenDetail} />
        ))}
        {done.length > 0 ? (
          <li className={cn(modeInsetHairline, "min-w-0 before:left-0")}>
            <details data-testid="cme-requirements-done" className="group">
              <summary
                className={cn(
                  modeRowHeight.single,
                  focusRing,
                  "flex cursor-pointer list-none items-center gap-3 py-2 [&::-webkit-details-marker]:hidden",
                )}
              >
                <CmeRowMark state="done" />
                <span className="min-w-0 flex-1 text-sm text-[color:var(--text-muted)]">
                  <span className="nums">{`${done.length} done`}</span>
                  {` · ${joinLabels(done.map((row) => row.title))}`}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-icon-sm shrink-0 text-[color:var(--text-muted)] motion-safe:transition-transform motion-safe:duration-[var(--duration-fast)] group-open:rotate-180"
                />
              </summary>
              <ul role="list" className="grid min-w-0">
                {done.map((row) => (
                  <Row key={row.id} row={row} isNext={false} onOpenDetail={onOpenDetail} />
                ))}
              </ul>
            </details>
          </li>
        ) : null}
      </CmeFlatList>
    </CmeGroup>
  );
}
