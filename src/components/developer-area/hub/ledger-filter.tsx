"use client";

import { useId, useMemo, useState } from "react";

import { LedgerItem } from "@/components/developer-area/hub/ledger-item";
import { META_CLASS, PanelSection } from "@/components/developer-area/hub/panel-primitives";
import { fieldControlPlain, fieldLabel } from "@/components/primitive-recipes/recipes";
import type { LedgerOpenItem } from "@/lib/developer-area/ledger-snapshot";

/**
 * One heading's worth of open items, in the order the page already decided
 * (P1 -> P2 -> P3 -> anything unrecognised). The page groups on the server and
 * hands the groups over as plain data, so this component never re-derives the
 * grouping and cannot drift from it.
 */
export type LedgerFilterGroup = {
  key: string;
  heading: string;
  note: string;
  items: LedgerOpenItem[];
};

const PRIORITY_OPTIONS = ["All", "P1", "P2", "P3"] as const;
const TYPE_OPTIONS = ["All", "issue", "task", "rec"] as const;

const GROUP_HEADING_CLASS = "text-sm font-semibold text-[color:var(--text-heading)]";

function matchesSearch(item: LedgerOpenItem, needle: string): boolean {
  if (needle.length === 0) return true;
  return [item.id, item.summary, item.detail].some((field) => field.toLowerCase().includes(needle));
}

/**
 * Client-side search and filter over the open items. Selects rather than
 * buttons: the page's contract is that it carries no `<button>` at all
 * (`tests/developer-ledger-page.dom.test.tsx`), and a native select is a
 * quiet outlined control that needs no wiring beyond its own change event.
 *
 * With every control at its default the list is exactly the unfiltered
 * grouped list, so the page reads the same as before this was added.
 */
export function LedgerFilter({ groups }: { groups: LedgerFilterGroup[] }) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<string>("All");
  const [type, setType] = useState<string>("All");
  const searchId = useId();
  const priorityId = useId();
  const typeId = useId();

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);
  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            (priority === "All" || item.priority === priority) &&
            (type === "All" || item.type === type) &&
            matchesSearch(item, needle),
        ),
      })),
    [groups, needle, priority, type],
  );
  const shown = filtered.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <div>
          <label htmlFor={searchId} className={fieldLabel}>
            Search the task list
          </label>
          <input
            id={searchId}
            type="search"
            data-testid="developer-ledger-search"
            className={fieldControlPlain}
            value={query}
            placeholder="Search ids, summaries, detail"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={priorityId} className={fieldLabel}>
            Priority
          </label>
          <select
            id={priorityId}
            data-testid="developer-ledger-filter-priority"
            className={fieldControlPlain}
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
          >
            {PRIORITY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={typeId} className={fieldLabel}>
            Type
          </label>
          <select
            id={typeId}
            data-testid="developer-ledger-filter-type"
            className={fieldControlPlain}
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p data-testid="developer-ledger-showing" role="status" className={META_CLASS}>
        Showing {shown} of {total}
      </p>

      {/*
       * A wrapper rather than one `<ul>`: each priority group needs its own
       * heading, and a heading between `<li>` siblings is not valid list
       * markup. Every open item still sits under this single test id, in
       * P1 -> P2 -> P3 order.
       */}
      <div data-testid="developer-ledger-open" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
        {filtered.map((group) => {
          if (group.items.length === 0) return null;
          return (
            <PanelSection
              key={group.key}
              headingId={`developer-ledger-open-${group.key}`}
              headingLevel="h3"
              headingClassName={GROUP_HEADING_CLASS}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2"
              heading={`${group.heading} · ${group.items.length}`}
            >
              <p className={META_CLASS}>{group.note}</p>
              <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
                {group.items.map((item) => (
                  <LedgerItem key={item.id} item={item} />
                ))}
              </ul>
            </PanelSection>
          );
        })}
        {shown === 0 ? (
          <p data-testid="developer-ledger-no-match" className={META_CLASS}>
            No open items match this search and filter.
          </p>
        ) : null}
      </div>
    </div>
  );
}
