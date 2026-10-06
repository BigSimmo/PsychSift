"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useState } from "react";

import { focusRing } from "@/components/card-recipes";
import { ModeActionButton } from "@/components/mode-kit/action-button";
import { OnCallGroupedList, OnCallRow } from "@/components/on-call/kit/grouped-list";
import { modeHeadingText } from "@/components/mode-kit/type";
import { OnCallUpdatedLine } from "@/components/on-call/kit/updated-line";
import { OnCallFilterChips } from "@/components/on-call/on-call-filter-chips";
import { Button } from "@/components/ui/button";
import { cn, textMuted } from "@/components/ui-primitives";
import { ON_CALL_FILTER_ALL } from "@/lib/on-call/entry-filters";
import type { ServiceContent, ServiceDetail, ServiceEntry } from "@/lib/on-call/service-model";

/**
 * Manage service › Needs checking (plan Task 4.3). Editors and admins only.
 *
 * Every published entry at this site, the longest-unchanged first, with its
 * open reports. The date is when the entry last changed ("Updated"), never
 * "Checked": the handbook records no check date (correction C6; Stage B adds
 * one). The reader's own entries keep their own "Check these" page.
 */

const HAS_REPORTS = "Has open reports";
const OLD = "Updated over 12 months ago";
const FILTERS = [ON_CALL_FILTER_ALL, HAS_REPORTS, OLD] as const;
type Filter = (typeof FILTERS)[number];

/** Rows shown before "Show all" (standard §4: about eight or nine). */
const ROWS_SHOWN = 9;

const SECTION_LABELS: Readonly<Record<ServiceContent["section"], string>> = {
  playbook: "Playbook",
  cover: "Role cover",
  contacts: "Contacts",
  referrals: "Referrals",
  resources: "Find",
  documentation: "Documentation",
  orientation: "Orientation",
  teaching: "Teaching",
  admin: "Admin",
};

function twelveMonthsBefore(now: Date): number {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return cutoff.getTime();
}

export function ServiceCheckingPanel({
  detail,
  siteId,
  onEdit,
  now,
}: {
  readonly detail: Pick<ServiceDetail, "entries" | "reports">;
  /** The site in view; service-wide entries show too. Omitted, every site shows. */
  readonly siteId?: string | null;
  readonly onEdit: (entry: ServiceEntry) => void;
  readonly now?: Date;
}) {
  const headingId = useId();
  const [filter, setFilter] = useState<Filter>(ON_CALL_FILTER_ALL);
  const [showAll, setShowAll] = useState(false);

  const openReports = useMemo(() => {
    const byEntry = new Map<string, string[]>();
    for (const report of detail.reports) {
      if (report.status !== "open") continue;
      byEntry.set(report.entryId, [...(byEntry.get(report.entryId) ?? []), report.reason]);
    }
    return byEntry;
  }, [detail.reports]);

  const entries = useMemo(
    () =>
      detail.entries
        .filter(
          (entry) =>
            entry.status !== "withdrawn" &&
            entry.publishedContent !== null &&
            (siteId === undefined ||
              entry.publishedContent.siteId === null ||
              entry.publishedContent.siteId === siteId),
        )
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt)),
    [detail.entries, siteId],
  );

  const cutoff = twelveMonthsBefore(now ?? new Date());
  const filtered = entries.filter((entry) => {
    if (filter === HAS_REPORTS) return openReports.has(entry.id);
    if (filter === OLD) return Date.parse(entry.updatedAt) < cutoff;
    return true;
  });
  const visible = showAll ? filtered : filtered.slice(0, ROWS_SHOWN);

  return (
    <section aria-labelledby={headingId} className="grid min-w-0 gap-3" data-testid="service-checking">
      <h2 id={headingId} className={cn(modeHeadingText, "text-lg-minus text-[color:var(--text-heading)]")}>
        What needs checking
      </h2>
      <OnCallFilterChips
        options={FILTERS}
        active={filter}
        onChange={(next) => {
          setFilter(next as Filter);
          setShowAll(false);
        }}
        label="Filter entries"
        testId="service-checking-filter"
      />
      {visible.length > 0 ? (
        <OnCallGroupedList>
          {visible.map((entry) => {
            const content = entry.publishedContent ?? entry.content;
            const reasons = openReports.get(entry.id) ?? [];
            return (
              <OnCallRow
                key={entry.id}
                testId={`service-checking-row-${entry.id}`}
                title={content.title}
                subtitle={SECTION_LABELS[content.section]}
                meta={
                  <>
                    <OnCallUpdatedLine updatedAt={entry.updatedAt} now={now} testId="on-call-updated-date" />
                    {reasons.length > 0 ? (
                      <details className="text-sm text-[color:var(--text)]">
                        <summary className={cn(focusRing, "flex min-h-12 cursor-pointer items-center rounded-sm")}>
                          {reasons.length === 1 ? "1 open report" : `${reasons.length} open reports`}
                        </summary>
                        <ul className={cn(textMuted, "grid gap-1 pb-2")}>
                          {reasons.map((reason, index) => (
                            <li key={`${index}:${reason}`} className="break-words">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </>
                }
                trailing={
                  <ModeActionButton icon={Pencil} label={`Edit ${content.title}`} onClick={() => onEdit(entry)} />
                }
              />
            );
          })}
        </OnCallGroupedList>
      ) : (
        <p className={cn(textMuted, "text-sm")}>
          {entries.length === 0 ? "Nothing published here yet." : "No entries match this filter."}
        </p>
      )}
      {filtered.length > ROWS_SHOWN && !showAll ? (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setShowAll(true)}>
          Show all {filtered.length}
        </Button>
      ) : null}
      <p className="text-sm text-[color:var(--text)]">
        Your own entries:{" "}
        <Link
          href="/on-call/check"
          className={cn(focusRing, "inline-flex min-h-12 items-center rounded-sm underline underline-offset-2")}
        >
          Check these
        </Link>
      </p>
    </section>
  );
}
