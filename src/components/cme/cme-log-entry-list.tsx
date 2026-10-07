"use client";

import { CmeCategoryDot, CmeFlatList, CmeFlatRow, CmeGroupLabel, CmeRowValue } from "@/components/cme/cme-flat-list";
import {
  CATEGORY_SHORT_LABELS,
  entryCategories,
  entryStatusWords,
  formatHoursShort,
  monthAnchorId,
  type MonthGroup,
} from "@/components/cme/cme-log-shared";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { cn } from "@/components/ui-primitives";
import { formatCmeRowDate } from "@/lib/cme/cpd-year";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import type { CmeEntry } from "@/lib/cme/types";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The row's date tile (work-mode redesign, owner request 6 Oct 2026): the
 * month small in copper over the day. The full date (weekday, and the year
 * when not this year) is read aloud instead.
 */
function DateColumn({ date, today }: { date: string; today: string }) {
  const day = Number(date.slice(8, 10));
  const month = SHORT_MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
  return (
    <span className="work-date">
      <span aria-hidden="true" className="work-date__month">
        {month}
      </span>
      <span aria-hidden="true" className="work-date__day">
        {day}
      </span>
      <span className="sr-only">{formatCmeRowDate(date, today)}</span>
    </span>
  );
}

/**
 * One activity as a flat row (mock-up screen 02): the date column, the title,
 * then one grey line — a small indigo-shade dot, the category, and what the
 * audit still needs — with the hours at the end. Colour only helps: the
 * category is always named in words beside its dot.
 */
function EntryRow({ entry, today }: { entry: CmeEntry; today: string }) {
  const categories = entryCategories(entry);
  const first = categories[0];
  const words = [categories.map((category) => CATEGORY_SHORT_LABELS[category]).join(" + "), ...entryStatusWords(entry)]
    .filter(Boolean)
    .join(" · ");
  return (
    <CmeFlatRow
      href={`/cme/log/${entry.id}`}
      testId={`cme-log-row-${entry.id}`}
      lead={<DateColumn date={entry.date} today={today} />}
      title={entry.title}
      subtitle={
        <>
          {first ? (
            <span className="mr-1.5 inline-flex align-[1px]">
              <CmeCategoryDot category={first} />
            </span>
          ) : null}
          {words}
        </>
      }
      end={
        // An archived row says "Archived" once, in its line; it carries no hours, as none count.
        entry.archivedAt ? undefined : <CmeRowValue value={formatHoursShort(totalAllocatedHours([entry]))} unit="h" />
      }
    />
  );
}

/**
 * The log's months, most recent first: an uppercase month label with the
 * month's hours at the right, then that month's flat list. The label row stays
 * pinned at the top of the page while its own rows scroll under it — a content
 * heading in page flow, not a second navigation bar. `showYear` adds the year
 * to each label when the list spans more than one year.
 */
export function CmeLogMonthList({
  groups,
  today,
  showYear = false,
}: {
  groups: readonly MonthGroup[];
  today: string;
  showYear?: boolean;
}) {
  return (
    <>
      {groups.map((group) => (
        <section
          key={group.key}
          id={monthAnchorId(group.key)}
          data-testid={`cme-log-month-${group.key}`}
          aria-labelledby={`${group.key}-heading`}
          className={cn(inPageAnchor, "grid gap-1.5")}
        >
          <div
            data-testid={`cme-log-month-header-${group.key}`}
            className="sticky top-0 z-[var(--z-raised)] flex min-h-8 items-center bg-[color:var(--surface-raised)]"
          >
            <div className="min-w-0 flex-1">
              <CmeGroupLabel
                id={`${group.key}-heading`}
                label={showYear ? group.label : group.label.split(" ")[0]}
                end={
                  <span className="nums text-xs font-normal normal-case tracking-normal text-[color:var(--text-muted)]">
                    {`${formatHoursShort(group.hours)}\u00a0h`}
                  </span>
                }
              />
            </div>
          </div>
          <CmeFlatList>
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} today={today} />
            ))}
          </CmeFlatList>
        </section>
      ))}
    </>
  );
}
