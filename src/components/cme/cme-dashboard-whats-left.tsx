"use client";

import {
  Award,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  LayoutGrid,
  Paperclip,
  PenLine,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

import { CmeFlatList, CmeGroup, CmeTextLink } from "@/components/cme/cme-flat-list";
import { CME_LOG_TRIGGER_ATTRIBUTE, openCmeQuickLog } from "@/components/cme/cme-quick-log";
import { CmeMiniMeter } from "@/components/cme/cme-work-kit";
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
 * Work-mode look (work-mode redesign, owner request 6 Oct 2026): each row leads
 * with a flat icon circle, ends in a small meter (an hours figure) or the word
 * for what a tap does ("Tag one", "Start", "Show", "Copy"), and the page's next
 * step sits first with a soft copper wash and its own "Log" button.
 *
 * A row opens what is behind it: an hours figure opens the Year page's detail
 * sheet (which activities make it up); a task opens its place in Set up; a
 * practice-domain count opens the Log form; a record check opens the Log
 * filtered to the activities it names.
 *
 * When the page's one next step is a row here (`nextStepRowId`), that row
 * carries the `cme-next-action` test id and the page does not repeat it.
 */

type WhatsLeftKind = "total" | "hours" | "domains" | "task" | "evidence" | "reflection" | "copied" | "other";

type WhatsLeftRow = {
  readonly id: string;
  readonly kind: WhatsLeftKind;
  /** How full an hours figure is, 0 to 1, for the row's small meter. */
  readonly fraction?: number;
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

function buildWhatsLeftRows({
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
      kind: "total",
      fraction: set.totalHours > 0 ? totalHours / set.totalHours : 0,
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
    const progress = status.progress;
    rows.push({
      id: row.id,
      kind: isHoursRequirementShape(shape) ? "hours" : shape === "task" ? "task" : "domains",
      fraction: progress && progress.target > 0 ? progress.value / progress.target : undefined,
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
      rows.push({
        id: row.id,
        kind: "other",
        title: row.label,
        subtitle: row.summary,
        ready: row.ready,
        href: row.action?.href,
      });
    }
  }

  for (const row of yearCheck.rows.filter((item) => item.group === "records")) {
    rows.push({
      id: row.id,
      kind: row.id === "evidence" || row.id === "reflection" || row.id === "copied" ? row.id : "other",
      title: row.label,
      subtitle: row.summary,
      ready: row.ready,
      // A row the app could not count opens the year check, which explains why.
      href: row.notChecked ? `/cme/check?year=${set.year}` : (row.action?.href ?? `/cme/log?year=${set.year}`),
    });
  }
  return rows;
}

const KIND_ICON: Record<WhatsLeftKind, LucideIcon> = {
  total: Award,
  hours: Users,
  domains: LayoutGrid,
  task: PenLine,
  evidence: Paperclip,
  reflection: PenLine,
  copied: Copy,
  other: Award,
};

/** The word on an open row's end: what a tap does. Hours rows show a meter instead. */
const KIND_ACTION: Partial<Record<WhatsLeftKind, string>> = {
  domains: "Tag one",
  task: "Start",
  evidence: "Show",
  reflection: "Show",
  copied: "Copy",
};

function RowEnd({ row, isNext }: { row: WhatsLeftRow; isNext: boolean }) {
  if (row.ready) return <ChevronRight aria-hidden="true" className="work-row__chev" />;
  // The next step's own Log button sits beside the row, so its end stays quiet.
  if (isNext && (row.kind === "hours" || row.kind === "total")) return null;
  if (row.fraction !== undefined && (row.kind === "hours" || row.kind === "total")) {
    // The row already says the figures ("16.5 of 25 h"), so the meter is for sight only.
    return <CmeMiniMeter fraction={row.fraction} />;
  }
  const word = KIND_ACTION[row.kind];
  if (word) {
    return (
      <span aria-hidden="true" className="work-button pointer-events-none" data-variant={isNext ? "primary" : "tinted"}>
        {word}
      </span>
    );
  }
  return <ChevronRight aria-hidden="true" className="work-row__chev" />;
}

function RowBody({ row, isNext }: { row: WhatsLeftRow; isNext: boolean }) {
  const Icon = row.ready ? Check : KIND_ICON[row.kind];
  return (
    <>
      <span
        aria-hidden="true"
        className="work-ic rounded-full"
        data-tone={isNext && !row.ready ? undefined : "neutral"}
      >
        <Icon aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="work-row__text">
        <span className="work-row__title break-words">{row.title}</span>
        <span className="work-row__sub nums line-clamp-2 break-words">{row.subtitle}</span>
      </span>
      <RowEnd row={row} isNext={isNext} />
    </>
  );
}

function logHere(event: MouseEvent<HTMLAnchorElement>) {
  // Opens the quick-log sheet where the page has one; otherwise the link opens the full form.
  if (openCmeQuickLog(event.currentTarget)) event.preventDefault();
}

function Row({
  row,
  isNext,
  year,
  onOpenDetail,
}: {
  row: WhatsLeftRow;
  isNext: boolean;
  year: number;
  onOpenDetail: (detail: string) => void;
}) {
  const detail = row.detail;
  const showLog = isNext && !row.ready && (row.kind === "hours" || row.kind === "total");
  return (
    <li
      data-met={row.ready ? "true" : "false"}
      data-testid={isNext ? "cme-next-action" : undefined}
      className={cn("flex min-w-0 items-center", isNext && "cpd-next")}
    >
      {detail ? (
        <button type="button" className="work-row min-h-tap min-w-0 flex-1" onClick={() => onOpenDetail(detail)}>
          <RowBody row={row} isNext={isNext} />
        </button>
      ) : (
        <Link href={row.href ?? "/cme/check"} className="work-row min-h-tap min-w-0 flex-1">
          <RowBody row={row} isNext={isNext} />
        </Link>
      )}
      {showLog ? (
        <Link
          href={`/cme/new?year=${year}`}
          onClick={logHere}
          {...{ [CME_LOG_TRIGGER_ATTRIBUTE]: "" }}
          className="work-button min-h-tap mr-2 shrink-0"
          data-variant="primary"
          aria-label={`Log an activity toward ${row.title}`}
          data-testid="cme-next-log"
        >
          Log
        </Link>
      ) : null}
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
  // The next step leads the list (the mockup's top row), the rest keep their gap order.
  const left = rows
    .filter((row) => !row.ready)
    .sort((a, b) => Number(b.id === nextStepRowId) - Number(a.id === nextStepRowId));
  const done = rows.filter((row) => row.ready);
  const label: ReactNode = left.length > 0 ? `What's left · ${left.length}` : "What's left";

  return (
    <CmeGroup
      label={label}
      testId="cme-requirements"
      end={
        <CmeTextLink href={`/cme/check?year=${set.year}`} testId="cme-year-check-link">
          Report
        </CmeTextLink>
      }
    >
      <CmeFlatList label="What's left">
        {left.length === 0 ? (
          <li className="work-row text-sm-minus text-[color:var(--text-muted)]">
            Everything in the year check is done.
          </li>
        ) : null}
        {left.map((row) => (
          <Row key={row.id} row={row} isNext={row.id === nextStepRowId} year={set.year} onOpenDetail={onOpenDetail} />
        ))}
        {done.length > 0 ? (
          <li className="min-w-0">
            <details data-testid="cme-requirements-done" className="group">
              <summary className="work-row cursor-pointer list-none text-xs font-semibold text-[color:var(--text-muted)] [&::-webkit-details-marker]:hidden">
                <span aria-hidden="true" className="work-ic work-ic--sm rounded-full" data-tone="neutral">
                  <Check aria-hidden="true" strokeWidth={2.4} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="nums font-normal">{`${done.length} done`}</span>
                  {` · ${joinLabels(done.map((row) => row.title))}`}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="work-row__chev motion-safe:transition-transform motion-safe:duration-[var(--duration-fast)] group-open:rotate-180"
                />
              </summary>
              <ul role="list" className="work-rows grid min-w-0 border-t border-[color:var(--work-line)]">
                {done.map((row) => (
                  <Row key={row.id} row={row} isNext={false} year={set.year} onOpenDetail={onOpenDetail} />
                ))}
              </ul>
            </details>
          </li>
        ) : null}
      </CmeFlatList>
    </CmeGroup>
  );
}
