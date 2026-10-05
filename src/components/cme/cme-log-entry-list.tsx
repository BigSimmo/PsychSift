"use client";

import { categoryNames, formatLogHours, monthAnchorId, type MonthGroup } from "@/components/cme/cme-log-shared";
import { inPageAnchor } from "@/components/in-page-nav/in-page-nav-classes";
import { ModeGroupedList, ModeRow } from "@/components/mode-kit/grouped-list";
import { ModeStateLabel } from "@/components/mode-kit/state-label";
import { modeNumberText } from "@/components/mode-kit/type";
import { cn, eyebrowText } from "@/components/ui-primitives";
import { formatCmeRowDate } from "@/lib/cme/cpd-year";
import { totalAllocatedHours } from "@/lib/cme/evaluate";
import { cmeCertificateMissing, type CmeEntry } from "@/lib/cme/types";

/**
 * One activity as a 52 px row in its month's hairline list (`ModeRow`: the
 * title at 500, the second line at 13 px muted): the day and the category,
 * then "No certificate" only when something is known to be missing, and the
 * hours at 400 beside the row's link. "No certificate" shows only when the log
 * has counted active certificates and found none (`cmeCertificateMissing`); an activity
 * whose evidence was not counted says nothing rather than guessing.
 */
function EntryRow({ entry, today }: { entry: CmeEntry; today: string }) {
  return (
    <ModeRow
      href={`/cme/log/${entry.id}`}
      testId={`cme-log-row-${entry.id}`}
      title={entry.title}
      subtitle={`${formatCmeRowDate(entry.date, today)} · ${categoryNames(entry)}`}
      meta={cmeCertificateMissing(entry) ? <ModeStateLabel>No certificate</ModeStateLabel> : null}
      trailing={
        // `nums font-normal` are repeated from the recipe so Task 7's scanner, which reads literal classes, sees 400.
        <span className={cn(modeNumberText, "nums font-normal pr-2 text-base-minus text-[color:var(--text)]")}>
          {entry.archivedAt ? "Archived" : `${formatLogHours(totalAllocatedHours([entry]))} h`}
        </span>
      }
    />
  );
}

/**
 * The log's months, most recent first. Each month header stays pinned at the
 * top of the page while its own rows scroll under it — the same in-flow sticky
 * group header On Call's contact groups use. It is a content heading inside
 * page flow, not a second navigation bar: it pins at `top-0` of the page
 * scroll, so the phone header's collapse row (which owns the viewport top)
 * still covers it whenever that header is showing.
 */
export function CmeLogMonthList({ groups, today }: { groups: readonly MonthGroup[]; today: string }) {
  return (
    <>
      {groups.map((group) => (
        <section
          key={group.key}
          id={monthAnchorId(group.key)}
          data-testid={`cme-log-month-${group.key}`}
          aria-labelledby={`${group.key}-heading`}
          className={cn(inPageAnchor, "grid gap-2")}
        >
          <div
            data-testid={`cme-log-month-header-${group.key}`}
            className="sticky top-0 z-[var(--z-raised)] flex min-h-8 items-center justify-between gap-3 bg-[color:var(--background)] px-3"
          >
            <h2 id={`${group.key}-heading`} className={eyebrowText}>
              {group.label}
            </h2>
            <span
              className={cn(modeNumberText, "nums font-normal text-2xs normal-case text-[color:var(--text-muted)]")}
            >
              {`${formatLogHours(group.hours)} h`}
            </span>
          </div>
          <ModeGroupedList>
            {group.entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} today={today} />
            ))}
          </ModeGroupedList>
        </section>
      ))}
    </>
  );
}
